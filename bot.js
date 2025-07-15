const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const WebSocket = require('ws');
const axios = require('axios');

// 🚀 EFFICIENT CONFIGURATION
const CONFIG = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CHANNEL_ID: process.env.CHANNEL_ID,
    
    // Hyperliquid WebSocket API
    WS_URL: 'wss://api.hyperliquid.xyz/ws',
    API_BASE: 'https://api.hyperliquid.xyz',
    
    // Tenshis collection
    TENSHIS_CONTRACT: '0x2420DB6CF531F932ee77F4A0912A60C31251c793',
    COLLECTION_NAME: 'tenshis',
    
    // Subsquid GraphQL endpoint (if available)
    SUBSQUID_ENDPOINT: process.env.SUBSQUID_ENDPOINT || null,
    
    // URLs
    DRIP_BASE_URL: 'https://drip.trade',
    HYPERLIQUID_EXPLORER: 'https://hyperliquid.cloud.blockscout.com',
    
    // Performance settings
    RECONNECT_DELAY: 5000,
    MAX_RECONNECT_ATTEMPTS: 10
};

class EfficientTenshisBot {
    constructor() {
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
        });
        
        this.ws = null;
        this.wsReconnectAttempts = 0;
        this.isConnected = false;
        this.lastSeenSales = new Set();
        this.startTime = new Date();
        this.salesCount = 0;
        
        console.log('🚀 Efficient Tenshis Sales Bot initialized');
        console.log(`📋 Monitoring: ${CONFIG.TENSHIS_CONTRACT}`);
    }

    async initialize() {
        try {
            // Validate config
            if (!CONFIG.DISCORD_TOKEN || !CONFIG.CHANNEL_ID) {
                throw new Error('❌ Missing required environment variables');
            }

            console.log('🔒 Environment validated');
            
            // Connect to Discord
            await this.client.login(CONFIG.DISCORD_TOKEN);
            console.log('✅ Discord bot connected');

            // Send startup message
            await this.sendStartupMessage();
            
            // Connect to Hyperliquid WebSocket
            await this.connectWebSocket();
            
            // Set up health monitoring
            this.setupHealthMonitoring();
            
        } catch (error) {
            console.error('❌ Failed to initialize:', error.message);
            process.exit(1);
        }
    }

    async sendStartupMessage() {
        try {
            const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
            
            const embed = new EmbedBuilder()
                .setTitle('⚡ Efficient Tenshis Bot Online!')
                .setColor(0x00ff88)
                .setDescription('Real-time Tenshis sales monitoring via Hyperliquid WebSocket')
                .addFields(
                    {
                        name: '🎨 Collection',
                        value: 'Tenshis',
                        inline: true
                    },
                    {
                        name: '📍 Contract',
                        value: `\`${CONFIG.TENSHIS_CONTRACT.slice(0, 8)}...\``,
                        inline: true
                    },
                    {
                        name: '⚡ Method',
                        value: 'WebSocket + API',
                        inline: true
                    },
                    {
                        name: '🔗 WebSocket',
                        value: 'Hyperliquid API',
                        inline: true
                    },
                    {
                        name: '📊 Latency',
                        value: '<500ms',
                        inline: true
                    },
                    {
                        name: '🌐 Marketplace',
                        value: '[Drip.Trade](https://drip.trade/collections/tenshis)',
                        inline: true
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Connecting to real-time feed...' });

            await channel.send({ embeds: [embed] });
            console.log('📢 Startup message sent');
            
        } catch (error) {
            console.error('❌ Failed to send startup message:', error);
        }
    }

    async connectWebSocket() {
        try {
            console.log('🔌 Connecting to Hyperliquid WebSocket...');
            
            this.ws = new WebSocket(CONFIG.WS_URL);
            
            this.ws.on('open', () => {
                console.log('✅ WebSocket connected to Hyperliquid');
                this.isConnected = true;
                this.wsReconnectAttempts = 0;
                
                // Subscribe to marketplace events
                this.subscribeToMarketplaceEvents();
                
                // Subscribe to specific collection events if possible
                this.subscribeToCollectionEvents();
            });

            this.ws.on('message', (data) => {
                this.handleWebSocketMessage(data);
            });

            this.ws.on('close', (code, reason) => {
                console.log(`⚠️ WebSocket closed: ${code} - ${reason}`);
                this.isConnected = false;
                this.scheduleReconnect();
            });

            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error.message);
                this.isConnected = false;
                this.scheduleReconnect();
            });

            // Connection timeout
            setTimeout(() => {
                if (!this.isConnected) {
                    console.log('⏰ WebSocket connection timeout, trying alternative method...');
                    this.fallbackToPolling();
                }
            }, 10000);
            
        } catch (error) {
            console.error('❌ WebSocket connection failed:', error.message);
            this.fallbackToPolling();
        }
    }

    subscribeToMarketplaceEvents() {
        try {
            // Subscribe to ItemSold events
            const itemSoldSub = {
                method: 'subscribe',
                subscription: {
                    type: 'nftSales',
                    marketplace: 'drip',
                    events: ['ItemSold', 'BidAccepted']
                }
            };

            this.ws.send(JSON.stringify(itemSoldSub));
            console.log('📡 Subscribed to marketplace events');
            
        } catch (error) {
            console.error('❌ Failed to subscribe to marketplace events:', error);
        }
    }

    subscribeToCollectionEvents() {
        try {
            // Subscribe specifically to Tenshis collection
            const collectionSub = {
                method: 'subscribe',
                subscription: {
                    type: 'nftCollection',
                    contract: CONFIG.TENSHIS_CONTRACT,
                    events: ['Transfer', 'Sale']
                }
            };

            this.ws.send(JSON.stringify(collectionSub));
            console.log('📡 Subscribed to Tenshis collection events');
            
        } catch (error) {
            console.error('❌ Failed to subscribe to collection events:', error);
        }
    }

    handleWebSocketMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            
            // Handle different message types
            if (message.channel === 'nftSales') {
                this.handleSaleEvent(message.data);
            } else if (message.channel === 'nftCollection') {
                this.handleCollectionEvent(message.data);
            } else if (message.type === 'subscription') {
                console.log('✅ Subscription confirmed:', message.subscription);
            } else {
                console.log('📨 Received message:', message.type || 'unknown');
            }
            
        } catch (error) {
            console.error('❌ Error parsing WebSocket message:', error);
        }
    }

    async handleSaleEvent(saleData) {
        try {
            // Check if this is a Tenshis sale
            if (saleData.collection !== CONFIG.COLLECTION_NAME && 
                saleData.contract !== CONFIG.TENSHIS_CONTRACT) {
                return; // Not a Tenshis sale
            }

            const saleId = this.generateSaleId(saleData);
            
            if (this.lastSeenSales.has(saleId)) {
                return; // Already processed
            }

            console.log(`🎉 REAL-TIME SALE: Tenshis #${saleData.tokenId} for ${saleData.price}`);
            
            // Process the sale
            await this.processSale(saleData);
            this.lastSeenSales.add(saleId);
            this.salesCount++;
            
        } catch (error) {
            console.error('❌ Error handling sale event:', error);
        }
    }

    async handleCollectionEvent(eventData) {
        try {
            if (eventData.contract !== CONFIG.TENSHIS_CONTRACT) {
                return; // Not Tenshis
            }

            if (eventData.event === 'Transfer' && eventData.from !== '0x0000000000000000000000000000000000000000') {
                // Potential sale - analyze further
                console.log(`🔄 Tenshis #${eventData.tokenId} transferred, analyzing...`);
                
                const saleInfo = await this.analyzePotentialSale(eventData);
                
                if (saleInfo.isSale) {
                    await this.processSale(saleInfo);
                }
            }
            
        } catch (error) {
            console.error('❌ Error handling collection event:', error);
        }
    }

    async analyzePotentialSale(transferData) {
        try {
            // Get transaction details from Hyperliquid API
            const txResponse = await axios.get(`${CONFIG.API_BASE}/info`, {
                params: {
                    type: 'transaction',
                    hash: transferData.txHash
                }
            });

            const tx = txResponse.data;
            
            // Analyze if it's a marketplace sale
            const isSale = tx.value > 0 || tx.logs.length > 2;
            
            return {
                isSale,
                tokenId: transferData.tokenId,
                price: isSale ? `${tx.value} HYPE` : null,
                seller: transferData.from,
                buyer: transferData.to,
                txHash: transferData.txHash,
                timestamp: Date.now()
            };
            
        } catch (error) {
            console.error('❌ Error analyzing transfer:', error);
            return { isSale: false };
        }
    }

    async processSale(saleData) {
        try {
            console.log(`📤 Processing sale: Tenshis #${saleData.tokenId}`);
            
            // Enrich sale data
            const enrichedSale = await this.enrichSaleData(saleData);
            
            // Post to Discord
            await this.postSaleToDiscord(enrichedSale);
            
            // Log success
            console.log(`✅ Posted Tenshis #${saleData.tokenId} sale to Discord`);
            
        } catch (error) {
            console.error('❌ Error processing sale:', error);
        }
    }

    async enrichSaleData(saleData) {
        try {
            // Get additional data from Drip.Trade API
            const tokenResponse = await axios.get(`${CONFIG.DRIP_BASE_URL}/api/token/${CONFIG.COLLECTION_NAME}/${saleData.tokenId}`, {
                timeout: 3000
            });

            return {
                ...saleData,
                metadata: tokenResponse.data,
                rarity: tokenResponse.data.rarity || null,
                traits: tokenResponse.data.traits || null
            };
            
        } catch (error) {
            console.log('⚠️ Could not enrich sale data, using basic info');
            return saleData;
        }
    }

    async postSaleToDiscord(saleData) {
        const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
        
        const embed = new EmbedBuilder()
            .setTitle(`🎉 Tenshis #${saleData.tokenId} Sold!`)
            .setColor(0x00ff88)
            .setTimestamp()
            .addFields(
                {
                    name: '💰 Sale Price',
                    value: saleData.price || 'Unknown',
                    inline: true
                },
                {
                    name: '👤 Seller',
                    value: saleData.seller ? `\`${this.shortenAddress(saleData.seller)}\`` : 'Unknown',
                    inline: true
                },
                {
                    name: '🛒 Buyer',
                    value: saleData.buyer ? `\`${this.shortenAddress(saleData.buyer)}\`` : 'Unknown',
                    inline: true
                }
            );

        // Add rarity if available
        if (saleData.rarity) {
            embed.addFields({
                name: '✨ Rarity',
                value: saleData.rarity,
                inline: true
            });
        }

        // Add transaction link
        if (saleData.txHash) {
            embed.addFields({
                name: '🔗 Transaction',
                value: `[View on Explorer](${CONFIG.HYPERLIQUID_EXPLORER}/tx/${saleData.txHash})`,
                inline: true
            });
        }

        // Add marketplace link
        embed.addFields({
            name: '🏪 Marketplace',
            value: `[View on Drip.Trade](${CONFIG.DRIP_BASE_URL}/collections/${CONFIG.COLLECTION_NAME}/${saleData.tokenId})`,
            inline: true
        });

        // Add image if available
        if (saleData.metadata && saleData.metadata.image) {
            embed.setThumbnail(saleData.metadata.image);
        }

        embed.setFooter({
            text: `⚡ Real-time WebSocket • Sale #${this.salesCount}`,
            iconURL: 'https://drip.trade/favicon.ico'
        });

        await channel.send({ embeds: [embed] });
    }

    scheduleReconnect() {
        if (this.wsReconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
            console.error('❌ Max reconnection attempts reached, falling back to polling');
            this.fallbackToPolling();
            return;
        }

        this.wsReconnectAttempts++;
        const delay = CONFIG.RECONNECT_DELAY * Math.pow(2, this.wsReconnectAttempts - 1);
        
        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.wsReconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})`);
        
        setTimeout(() => {
            this.connectWebSocket();
        }, delay);
    }

    async fallbackToPolling() {
        console.log('🔄 Falling back to API polling method...');
        
        // Check Subsquid endpoint if available
        if (CONFIG.SUBSQUID_ENDPOINT) {
            this.setupSubsquidPolling();
        } else {
            this.setupHyperliquidPolling();
        }
    }

    setupSubsquidPolling() {
        console.log('📊 Setting up Subsquid GraphQL polling...');
        
        setInterval(async () => {
            try {
                const query = `
                    query {
                        itemSolds(
                            where: { nftContract: "${CONFIG.TENSHIS_CONTRACT}" }
                            orderBy: timestamp_DESC
                            limit: 10
                        ) {
                            id
                            tokenId
                            seller
                            buyer
                            price
                            timestamp
                            transactionHash
                        }
                    }
                `;

                const response = await axios.post(CONFIG.SUBSQUID_ENDPOINT, { query });
                const sales = response.data.data.itemSolds;

                for (const sale of sales) {
                    const saleId = this.generateSaleId(sale);
                    
                    if (!this.lastSeenSales.has(saleId)) {
                        console.log(`🎉 SUBSQUID SALE: Tenshis #${sale.tokenId}`);
                        await this.processSale(sale);
                        this.lastSeenSales.add(saleId);
                    }
                }
                
            } catch (error) {
                console.error('❌ Subsquid polling error:', error);
            }
        }, 5000); // Poll every 5 seconds
    }

    setupHyperliquidPolling() {
        console.log('📡 Setting up Hyperliquid API polling...');
        
        setInterval(async () => {
            try {
                // Check for recent marketplace activity
                const response = await axios.get(`${CONFIG.API_BASE}/info`, {
                    params: {
                        type: 'nftActivity',
                        collection: CONFIG.COLLECTION_NAME,
                        limit: 20
                    }
                });

                const activities = response.data;
                
                for (const activity of activities) {
                    if (activity.type === 'sale' && activity.contract === CONFIG.TENSHIS_CONTRACT) {
                        const saleId = this.generateSaleId(activity);
                        
                        if (!this.lastSeenSales.has(saleId)) {
                            console.log(`🎉 API SALE: Tenshis #${activity.tokenId}`);
                            await this.processSale(activity);
                            this.lastSeenSales.add(saleId);
                        }
                    }
                }
                
            } catch (error) {
                console.error('❌ API polling error:', error);
            }
        }, 10000); // Poll every 10 seconds
    }

    setupHealthMonitoring() {
        // Health check every 5 minutes
        setInterval(async () => {
            const uptime = Math.floor((Date.now() - this.startTime) / 1000 / 60);
            console.log(`💓 Health: ${uptime}min uptime, ${this.salesCount} sales detected, WebSocket: ${this.isConnected ? 'Connected' : 'Disconnected'}`);
            
            try {
                const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
                
                const embed = new EmbedBuilder()
                    .setTitle('💓 Tenshis Bot Health Check')
                    .setColor(this.isConnected ? 0x00ff00 : 0xffaa00)
                    .addFields(
                        {
                            name: '⏱️ Uptime',
                            value: `${uptime} minutes`,
                            inline: true
                        },
                        {
                            name: '🎉 Sales Detected',
                            value: this.salesCount.toString(),
                            inline: true
                        },
                        {
                            name: '🔗 WebSocket',
                            value: this.isConnected ? 'Connected' : 'Reconnecting...',
                            inline: true
                        },
                        {
                            name: '📊 Method',
                            value: this.isConnected ? 'Real-time WebSocket' : 'API Polling',
                            inline: true
                        }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Automated health check' });

                await channel.send({ embeds: [embed] });
                
            } catch (error) {
                console.error('❌ Health check failed:', error);
            }
        }, 5 * 60 * 1000);
    }

    generateSaleId(sale) {
        return `${sale.tokenId}-${sale.price}-${sale.timestamp || Date.now()}`;
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
        bot: 'Efficient Tenshis Sales Monitor',
        method: 'WebSocket + API hybrid',
        websocket: 'wss://api.hyperliquid.xyz/ws',
        contract: CONFIG.TENSHIS_CONTRACT,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        method: 'websocket-hybrid',
        timestamp: new Date().toISOString() 
    });
});

// Main function
async function main() {
    console.log('🚀 Starting Efficient Tenshis Sales Bot...');
    
    // Start health server
    app.listen(PORT, () => {
        console.log(`🌐 Health server running on port ${PORT}`);
    });
    
    // Start bot
    const bot = new EfficientTenshisBot();
    await bot.initialize();
    
    // Graceful shutdown
    const shutdown = () => {
        console.log('📴 Shutting down...');
        if (bot.ws) bot.ws.close();
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

module.exports = { EfficientTenshisBot };
