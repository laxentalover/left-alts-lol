#!/bin/bash
set -e  # Exit on any error

echo "🚀 Setting up Bot Storm environment..."

# Update package lists
echo "📦 Updating package lists..."
sudo apt-get update

# Install required system dependencies
echo "📚 Installing system dependencies..."
sudo apt-get install -y curl wget git build-essential

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "🟢 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Verify Node.js installation
node --version || (echo "❌ Node.js installation failed" && exit 1)

# Install pnpm if not present
if ! command -v pnpm &> /dev/null; then
    echo "📦 Installing pnpm..."
    curl -fsSL https://get.pnpm.io/install.sh | sh -
    # Add pnpm to current shell PATH
    export PNPM_HOME="$HOME/.local/share/pnpm"
    export PATH="$PNPM_HOME:$PATH"
fi

# Verify pnpm installation
pnpm --version || (echo "❌ pnpm installation failed" && exit 1)

# Create package.json if it doesn't exist
if [ ! -f package.json ]; then
    echo "📝 Initializing pnpm project..."
    pnpm init -y
    # Update package.json to include type: module
    sed -i '/"name":/a \ \ "type": "module",' package.json
fi

# Install all required dependencies
echo "📥 Installing Node.js dependencies..."
pnpm add \
    mineflayer \
    socks \
    chalk \
    gradient-string \
    figlet \
    ora \
    boxen \
    cli-table3 \
    minecraft-protocol

# Make the bot script executable
chmod +x botattack.js

# Create necessary directories
mkdir -p bot-data/{logs,proxies,configs,scripts}

echo "✅ Setup complete!"
echo "➡️  You can now run: ./botattack.js <host:port> <version> [maxBots] [delay]"
echo "📝 Example: ./botattack.js localhost:25565 1.20.1 10 3000"
