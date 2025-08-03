#!/bin/bash

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install pnpm if not installed
if ! command -v pnpm &> /dev/null; then
    echo "Installing pnpm..."
    curl -fsSL https://get.pnpm.io/install.sh | sh -
    source ~/.bashrc
fi

# Create package.json if it doesn't exist
if [ ! -f package.json ]; then
    echo "Initializing pnpm project..."
    pnpm init
fi

# Install required dependencies
echo "Installing dependencies..."
pnpm add \
    mineflayer \
    socks \
    chalk \
    gradient-string \
    figlet \
    ora \
    boxen

# Make the bot script executable
chmod +x botattack.js

echo "Setup complete! You can now run ./botattack.js <host:port> <version> [maxBots] [delay]"
echo "Example: ./botattack.js localhost:25565 1.20.1 10 3000"
