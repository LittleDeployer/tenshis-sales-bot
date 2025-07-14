const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { ethers } = require('ethers');
const axios = require('axios');

// 🔒 SAFE CONFIGURATION - No secrets hardcoded!
const CONFIG = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CHANNEL_ID: process.env.CHANNEL_ID,
    
    // Public configuration
    RPC_URL: 'https://rpc.hyperliquid.xyz/evm',
    TENSHIS_CONTRACT_ADDRESS: '0x2420DB6CF531F932ee77F4A0912A60C31251c793',
    POLLING_INTERVAL: parseInt(process.env.POLLING_INTERVAL) || 60000,
    DRIP_BASE_URL: 'https://drip.trade',
    HYPERLIQUID_EXPLORER: 'https://hyperliquid.cloud.blockscout.com'
};

class TenshisSalesBot {
    constructor() {
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
        });
        
        this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
        this.lastSeenSales = new Set();
        this.isRunning = false;
        this.monitoringCount = 0;
        this.startTime = new Date();
        
        console.log('🤖 Tenshis Sales Bot initialized');
        console.log(`📋 Tenshis Contract: ${CONFIG.TENSHIS_CONTRACT_ADDRESS}`);
    }

    async initialize() {
        try {
            // Security check
            if (!CONFIG.DISCORD_TOKEN) {
                throw new Error('❌ DISCORD_TOKEN environment variable is required!');
            }
            if (!CONFIG.CHANNEL_ID) {
                throw new Error('❌ CHANNEL_ID environment variable is required!');
            }

            console.log('🔒 Environment variables loaded securely');
            
            // Connect to Discord
            await this.client.login(CONFIG.DISCORD_TOKEN);
            console.log('✅ Discord bot connected successfully!');

            // Send startup message
            await this.sendStartupMessage();
            
            // Start monitoring with better error handling
            this.startMonitoring();
            
        } catch (error) {
            console.error('❌ Failed to initialize bot:', error.message);
            process.exit(1);
        }
    }

    async sendStartupMessage() {
        try {
            const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
            
            const embed = new EmbedBuilder()
                .setTitle('🚀 Tenshis Sales Bot Online!')
                .setColor(0x7C3AED)
                .setDescription('Now monitoring Tenshis NFT sales on Drip.Trade')
                .addFields(
                    {
                        name: '🎨 Collection',
                        value: 'Tenshis',
                        inline: true
                    },
                    {
                        name: '📍 Contract',
                        value: `\`${CONFIG.TENSHIS_CONTRACT_ADDRESS.slice(0, 8)}...\``,
                        inline: true
                    },
                    {
                        name: '🔄 Check Interval',
                        value: `${CONFIG.POLLING_INTERVAL / 1000}s`,
                        inline: true
                    },
                    {
                        name: '🌐 Marketplace',
                        value: '[Drip.Trade](https://drip.trade/collections/tenshis)',
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Ready to detect sales!' });

            await channel.send({ embeds: [embed] });
            console.log('📢 Startup message sent to Discord');
            
        } catch (error) {
            console.error('❌ Failed to send startup message:', error);
            throw error; // This will help us see if Discord permissions are the issue
        }
    }

    startMonitoring() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log(`🔍 Started monitoring every ${CONFIG.POLLING_INTERVAL / 1000} seconds`);
        
        // Initial check after 5 seconds
        setTimeout(() => {
            this.performMonitoringCheck();
        }, 5000);
        
        // Regular monitoring interval
        setInterval(() => {
            this.performMonitoringCheck();
        }, CONFIG.POLLING_INTERVAL);

        // Health check every 5 minutes
        setInterval(() => {
            this.sendHealthCheck();
        }, 5 * 60 * 1000);
    }

    async performMonitoringCheck() {
        this.monitoringCount++;
        const timestamp = new Date().toISOString();
        
        console.log(`🔍 [${timestamp}] Monitoring check #${this.monitoringCount} - Looking for Tenshis sales...`);
        
        try {
            // Method 1: Check Drip.Trade API
            await this.checkDripAPI();
            
            // Method 2: Check collection page
            await this.checkCollectionPage();
            
            console.log(`✅ [${timestamp}] Monitoring check #${this.monitoringCount} completed successfully`);
            
        } catch (error) {
            console.error(`❌ [${timestamp}] Monitoring check #${this.monitoringCount} failed:`, error.message);
            
            // Send error notification to Discord (helps with debugging)
            try {
                await this.sendErrorNotification(error);
            } catch (discordError) {
                console.error('❌ Could not send error notification to Discord:', discordError.message);
            }
        }
    }

    async checkDripAPI() {
        console.log('🌐 Checking Drip.Trade API endpoints...');
        
        const endpoints = [
            '/api/collections/tenshis/activity',
            '/api/collections/tenshis/sales', 
            '/api/v1/collections/tenshis/recent',
            '/api/activity?collection=tenshis'
        ];

        for (const endpoint of endpoints) {
            try {
                console.log(`📡 Trying endpoint: ${endpoint}`);
                
                const response = await axios.get(`${CONFIG.DRIP_BASE_URL}${endpoint}`, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (compatible; TenshiBot/1.0)',
                    },
                    timeout: 10000
                });

                console.log(`📊 Response status: ${response.status}, Data type: ${typeof response.data}`);

                if (response.data && Array.isArray(response.data) && response.data.length > 0) {
                    console.log(`✅ Found ${response.data.length} items in API response`);
                    await this.processSalesData(response.data, 'api');
                    return; // Success, no need to try other endpoints
                } else {
                    console.log(`📭 No sales data in ${endpoint}`);
                }
                
            } catch (error) {
                console.log(`❌ Endpoint ${endpoint} failed: ${error.message}`);
            }
        }
        
        console.log('⚠️ No working API endpoints found');
    }

    async checkCollectionPage() {
        console.log('🌐 Checking Tenshis collection page...');
        
        try {
            const url = `${CONFIG.DRIP_BASE_URL}/collections/tenshis`;
            
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000
            });

            console.log(`📊 Collection page response: ${response.status} (${response.data.length} chars)`);

            // Look for embedded JSON data patterns
            const patterns = [
                /window\.__INITIAL_STATE__\s*=\s*({.*?});/s,
                /window\.__NUXT__\s*=\s*({.*?});/s,
                /"sales":\s*(\[.*?\])/s,
                /"activity":\s*(\[.*?\])/s,
                /"recentSales":\s*(\[.*?\])/s
            ];

            for (const pattern of patterns) {
                const match = response.data.match(pattern);
                if (match) {
                    try {
                        console.log(`🔍 Found JSON pattern, attempting to parse...`);
                        const data = JSON.parse(match[1]);
                        const sales = this.extractSalesFromData(data);
                        
                        if (sales.length > 0) {
                            console.log(`✅ Extracted ${sales.length} sales from page data`);
                            await this.processSalesData(sales, 'scraping');
                            return;
                        }
                    } catch (parseError) {
                        console.log(`⚠️ Could not parse JSON pattern: ${parseError.message}`);
                    }
                }
            }
            
            console.log('📭 No sales data found in collection page');
            
        } catch (error) {
            console.log(`❌ Collection page check failed: ${error.message}`);
        }
    }

    extractSalesFromData(data) {
        const sales = [];
        
        // Recursive function to find sales-like objects
        const findSales = (obj, path = '') => {
            if (Array.isArray(obj)) {
                for (const item of obj) {
                    if (item && typeof item === 'object' && 
                        (item.tokenId || item.token_id || item.id) && 
                        (item.price || item.sale_price || item.amount)) {
                        sales.push(item);
                    }
                    findSales(item, path);
                }
            } else if (obj && typeof obj === 'object') {
                for (const [key, value] of Object.entries(obj)) {
                    if (key.toLowerCase().includes('sale') || 
                        key.toLowerCase().includes('activity') || 
                        key.toLowerCase().includes('trade')) {
                        findSales(value, `${path}.${key}`);
                    }
                }
            }
        };

        findSales(data);
        return sales;
    }

    async processSalesData(rawData, source) {
        console.log(`🔄 Processing ${rawData.length} items from ${source}...`);
        
        const sales = rawData.map(item => ({
            tokenId: item.token_id || item.tokenId || item.id,
            price: this.formatPrice(item.price || item.sale_price || item.amount),
            seller: item.seller || item.from_address || item.from,
            buyer: item.buyer || item.to_address || item.to,
            timestamp: item.timestamp || item.created_at || Date.now(),
            txHash: item.transaction_hash || item.txHash,
            source: source
        })).filter(sale => sale.tokenId && sale.price && sale.price !== 'Unknown');

        console.log(`📊 Found ${sales.length} valid sales after filtering`);

        let newSalesCount = 0;

        for (const sale of sales) {
            const saleId = this.generateSaleId(sale);
            
            if (!this.lastSeenSales.has(saleId)) {
                console.log(`🎉 NEW SALE DETECTED: Tenshis #${sale.tokenId} for ${sale.price} (via ${source})`);
                
                try {
                    await this.postSaleToDiscord(sale);
                    this.lastSeenSales.add(saleId);
                    newSalesCount++;
                    
                    // Small delay between posts
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (error) {
                    console.error(`❌ Failed to post sale ${sale.tokenId} to Discord:`, error.message);
                }
            } else {
                console.log(`📋 Already seen sale: Tenshis #${sale.tokenId}`);
            }
        }

        if (newSalesCount > 0) {
            console.log(`✅ Posted ${newSalesCount} new sales to Discord`);
        } else {
            console.log(`📭 No new sales found`);
        }

        // Memory management
        if (this.lastSeenSales.size > 500) {
            const oldSales = Array.from(this.lastSeenSales).slice(0, 250);
            this.lastSeenSales = new Set(oldSales);
            console.log('🧹 Cleaned up old sales from memory');
        }
    }

    formatPrice(price) {
        if (!price) return 'Unknown';
        
        if (typeof price === 'string') {
            if (price.includes('HYPE')) return price;
            if (price.includes('ETH')) return price;
            return `${price} HYPE`;
        }
        
        if (typeof price === 'number') {
            return `${price} HYPE`;
        }
        
        return `${price} HYPE`;
    }

    generateSaleId(sale) {
        return `${sale.tokenId}-${sale.price}-${sale.timestamp}`.toLowerCase();
    }

    async postSaleToDiscord(sale) {
        console.log(`📤 Posting sale to Discord: Tenshis #${sale.tokenId}`);
        
        const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
        
        const embed = new EmbedBuilder()
            .setTitle(`🎉 Tenshis #${sale.tokenId} Sold!`)
            .setColor(0x7C3AED)
            .setTimestamp()
            .addFields(
                {
                    name: '💰 Sale Price',
                    value: sale.price,
                    inline: true
                },
                {
                    name: '👤 Seller',
                    value: sale.seller ? `\`${this.shortenAddress(sale.seller)}\`` : 'Unknown',
                    inline: true
                },
                {
                    name: '🛒 Buyer',
                    value: sale.buyer ? `\`${this.shortenAddress(sale.buyer)}\`` : 'Unknown',
                    inline: true
                }
            );

        if (sale.txHash) {
            embed.addFields({
                name: '🔗 Transaction',
                value: `[View on Explorer](${CONFIG.HYPERLIQUID_EXPLORER}/tx/${sale.txHash})`,
                inline: true
            });
        }

        embed.addFields({
            name: '🏪 Marketplace',
            value: `[View on Drip.Trade](${CONFIG.DRIP_BASE_URL}/collections/tenshis/${sale.tokenId})`,
            inline: true
        });

        const sourceIcon = sale.source === 'api' ? '🌐' : '📄';
        embed.setFooter({
            text: `${sourceIcon} Detected via ${sale.source} • Check #${this.monitoringCount}`,
            iconURL: 'https://drip.trade/favicon.ico'
        });

        await channel.send({ embeds: [embed] });
        console.log(`✅ Successfully posted Tenshis #${sale.tokenId} sale to Discord`);
    }

    async sendHealthCheck() {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000 / 60); // minutes
        console.log(`💓 Health check: Bot running for ${uptime} minutes, completed ${this.monitoringCount} monitoring checks`);
        
        try {
            const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
            
            const embed = new EmbedBuilder()
                .setTitle('💓 Bot Health Check')
                .setColor(0x00ff00)
                .setDescription(`Bot is running smoothly`)
                .addFields(
                    {
                        name: '⏱️ Uptime',
                        value: `${uptime} minutes`,
                        inline: true
                    },
                    {
                        name: '🔍 Checks Completed',
                        value: `${this.monitoringCount}`,
                        inline: true
                    },
                    {
                        name: '💾 Sales Tracked',
                        value: `${this.lastSeenSales.size}`,
                        inline: true
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Automatic health check' });

            await channel.send({ embeds: [embed] });
            
        } catch (error) {
            console.error('❌ Health check failed:', error.message);
        }
    }

    async sendErrorNotification(error) {
        const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
        
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Bot Monitoring Error')
            .setColor(0xff9900)
            .setDescription('Bot encountered an error but is still running')
            .addFields({
                name: '❌ Error Details',
                value: `\`\`\`${error.message.slice(0, 1000)}\`\`\``,
                inline: false
            })
            .setTimestamp()
            .setFooter({ text: 'Bot will continue monitoring' });

        await channel.send({ embeds: [embed] });
    }

    shortenAddress(address) {
        if (!address || address.length < 10) return address || 'Unknown';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
}

// Health check server
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot: 'Tenshis Sales Monitor',
        tenshisContract: CONFIG.TENSHIS_CONTRACT_ADDRESS,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString() 
    });
});

// Main function
async function main() {
    console.log('🚀 Starting Tenshis Sales Bot with improved monitoring...');
    
    // Start health server
    app.listen(PORT, () => {
        console.log(`🌐 Health server running on port ${PORT}`);
    });
    
    // Start bot
    const bot = new TenshisSalesBot();
    await bot.initialize();
    
    // Graceful shutdown
    const shutdown = () => {
        console.log('📴 Shutting down gracefully...');
        bot.client.destroy();
        process.exit(0);
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { TenshisSalesBot };
