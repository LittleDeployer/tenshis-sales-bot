const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { ethers } = require('ethers');
const axios = require('axios');

// 🔒 SAFE CONFIGURATION - No secrets hardcoded!
// Secrets come from Railway environment variables
const CONFIG = {
    // These get values from Railway dashboard (secure)
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CHANNEL_ID: process.env.CHANNEL_ID,
    
    // Public configuration (safe to hardcode)
    RPC_URL: 'https://rpc.hyperliquid.xyz/evm',
    TENSHIS_CONTRACT_ADDRESS: '0x2420DB6CF531F932ee77F4A0912A60C31251c793',
    DRIP_MARKETPLACE_ADDRESS: null, // Auto-discovered
    POLLING_INTERVAL: parseInt(process.env.POLLING_INTERVAL) || 60000,
    DRIP_BASE_URL: 'https://drip.trade',
    HYPERLIQUID_EXPLORER: 'https://hyperliquid.cloud.blockscout.com'
};

// Contract ABIs
const ERC721_ABI = [
    "function name() external view returns (string memory)",
    "function symbol() external view returns (string memory)",
    "function tokenURI(uint256 tokenId) external view returns (string memory)",
    "function totalSupply() external view returns (uint256)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];

const MARKETPLACE_EVENT_SIGNATURES = [
    "ItemSold(address,uint256,address,address,uint256,uint256)",
    "Sale(address,uint256,address,address,uint256)",
    "BidAccepted(address,uint256,address,address,uint256)",
    "OrderFulfilled(bytes32,address,address,address,address,address,uint256,uint256)"
];

class TenshisSalesBot {
    constructor() {
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
        });
        
        this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
        this.lastProcessedBlock = 0;
        this.lastSeenSales = new Set();
        this.marketplaceContract = null;
        this.tenshisContract = null;
        this.isRunning = false;
        
        console.log('🤖 Tenshis Sales Bot initialized');
        console.log(`📋 Tenshis Contract: ${CONFIG.TENSHIS_CONTRACT_ADDRESS}`);
    }

    async initialize() {
        try {
            // Security check
            if (!CONFIG.DISCORD_TOKEN) {
                throw new Error('❌ DISCORD_TOKEN environment variable is required! Please set it in Railway dashboard.');
            }
            if (!CONFIG.CHANNEL_ID) {
                throw new Error('❌ CHANNEL_ID environment variable is required! Please set it in Railway dashboard.');
            }

            console.log('🔒 Environment variables loaded securely');
            
            // Connect to Discord
            await this.client.login(CONFIG.DISCORD_TOKEN);
            console.log('✅ Discord bot connected successfully!');

            // Verify Tenshis contract
            await this.verifyTenshisContract();
            
            // Try to discover marketplace contract
            await this.discoverMarketplaceContract();
            
            // Get starting block
            this.lastProcessedBlock = await this.provider.getBlockNumber();
            console.log(`📦 Starting from block: ${this.lastProcessedBlock}`);
            
            // Send startup message
            await this.sendStartupMessage();
            
            // Start monitoring
            this.startMonitoring();
            
        } catch (error) {
            console.error('❌ Failed to initialize bot:', error.message);
            process.exit(1);
        }
    }

    async verifyTenshisContract() {
        try {
            console.log('🔍 Verifying Tenshis contract...');
            
            this.tenshisContract = new ethers.Contract(
                CONFIG.TENSHIS_CONTRACT_ADDRESS,
                ERC721_ABI,
                this.provider
            );

            const name = await this.tenshisContract.name();
            const symbol = await this.tenshisContract.symbol();
            
            console.log(`✅ Contract verified: ${name} (${symbol})`);
            
            try {
                const totalSupply = await this.tenshisContract.totalSupply();
                console.log(`📊 Total Supply: ${totalSupply.toString()}`);
            } catch (e) {
                console.log('📊 Total Supply: Not available');
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Failed to verify Tenshis contract:', error.message);
            throw error;
        }
    }

    async discoverMarketplaceContract() {
        console.log('🔍 Auto-discovering Drip.Trade marketplace contract...');
        
        try {
            const currentBlock = await this.provider.getBlockNumber();
            const searchBlocks = 5000;
            const fromBlock = Math.max(377808, currentBlock - searchBlocks);
            
            console.log(`🔎 Searching blocks ${fromBlock} to ${currentBlock}...`);
            
            // Look for Tenshis transfers
            const transferLogs = await this.provider.getLogs({
                address: CONFIG.TENSHIS_CONTRACT_ADDRESS,
                topics: [ethers.id("Transfer(address,address,uint256)")],
                fromBlock,
                toBlock: currentBlock
            });

            console.log(`📋 Found ${transferLogs.length} Tenshis transfer events`);

            if (transferLogs.length === 0) {
                console.log('⚠️ No recent transfers found. Using API monitoring only.');
                return false;
            }

            // Find potential marketplaces
            const potentialMarketplaces = new Set();
            
            for (const log of transferLogs.slice(0, 20)) {
                try {
                    const tx = await this.provider.getTransaction(log.transactionHash);
                    if (tx && tx.to && tx.to !== CONFIG.TENSHIS_CONTRACT_ADDRESS) {
                        potentialMarketplaces.add(tx.to);
                    }
                } catch (e) {
                    // Continue
                }
            }

            console.log(`🏪 Found ${potentialMarketplaces.size} potential marketplace contracts`);

            // Test each potential marketplace
            for (const marketplaceAddr of potentialMarketplaces) {
                try {
                    const success = await this.testMarketplaceContract(marketplaceAddr, fromBlock, currentBlock);
                    if (success) {
                        CONFIG.DRIP_MARKETPLACE_ADDRESS = marketplaceAddr;
                        console.log(`✅ Discovered marketplace: ${marketplaceAddr}`);
                        return true;
                    }
                } catch (e) {
                    // Continue
                }
            }

            console.log('⚠️ Marketplace contract not found. Using API monitoring only.');
            return false;
            
        } catch (error) {
            console.error('❌ Error discovering marketplace:', error.message);
            return false;
        }
    }

    async testMarketplaceContract(address, fromBlock, toBlock) {
        try {
            for (const eventSig of MARKETPLACE_EVENT_SIGNATURES) {
                const eventId = ethers.id(eventSig);
                
                const logs = await this.provider.getLogs({
                    address,
                    topics: [eventId],
                    fromBlock: Math.max(fromBlock, toBlock - 1000),
                    toBlock
                });

                if (logs.length > 0) {
                    console.log(`🎯 Found ${logs.length} ${eventSig.split('(')[0]} events at ${address}`);
                    this.setupMarketplaceContract(address, eventSig);
                    return true;
                }
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    setupMarketplaceContract(address, eventSignature) {
        const abi = [`event ${eventSignature}`];
        this.marketplaceContract = new ethers.Contract(address, abi, this.provider);
        console.log(`🔧 Marketplace contract configured: ${eventSignature.split('(')[0]}`);
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
                        name: '🔄 Monitoring',
                        value: CONFIG.DRIP_MARKETPLACE_ADDRESS ? 'Blockchain + API' : 'API Only',
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
        }
    }

    startMonitoring() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log(`🔍 Started monitoring every ${CONFIG.POLLING_INTERVAL / 1000}s`);
        
        // Monitor using both methods
        setInterval(async () => {
            try {
                // Blockchain monitoring (if marketplace found)
                if (this.marketplaceContract) {
                    await this.checkBlockchainSales();
                }
                
                // API monitoring (always runs)
                await this.checkAPISales();
                
            } catch (error) {
                console.error('❌ Monitoring error:', error);
            }
        }, CONFIG.POLLING_INTERVAL);
    }

    async checkBlockchainSales() {
        try {
            const currentBlock = await this.provider.getBlockNumber();
            
            if (currentBlock <= this.lastProcessedBlock) return;

            const logs = await this.provider.getLogs({
                address: CONFIG.DRIP_MARKETPLACE_ADDRESS,
                fromBlock: this.lastProcessedBlock + 1,
                toBlock: currentBlock
            });
            
            for (const log of logs) {
                await this.processBlockchainSale(log);
            }

            this.lastProcessedBlock = currentBlock;
            
        } catch (error) {
            console.error('❌ Blockchain monitoring error:', error);
        }
    }

    async processBlockchainSale(log) {
        try {
            if (this.marketplaceContract) {
                const parsedLog = this.marketplaceContract.interface.parseLog(log);
                
                if (parsedLog) {
                    const { args } = parsedLog;
                    const nftContract = args[0];
                    
                    if (nftContract && nftContract.toLowerCase() === CONFIG.TENSHIS_CONTRACT_ADDRESS.toLowerCase()) {
                        const saleData = {
                            tokenId: args[1].toString(),
                            seller: args[2],
                            buyer: args[3],
                            price: `${ethers.formatEther(args[4])} HYPE`,
                            txHash: log.transactionHash,
                            blockNumber: log.blockNumber,
                            source: 'blockchain'
                        };

                        const saleId = this.generateSaleId(saleData);
                        
                        if (!this.lastSeenSales.has(saleId)) {
                            console.log(`🎉 Blockchain sale: Tenshis #${saleData.tokenId} for ${saleData.price}`);
                            await this.postSaleToDiscord(saleData);
                            this.lastSeenSales.add(saleId);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('❌ Error processing blockchain sale:', error);
        }
    }

    async checkAPISales() {
        try {
            const methods = [
                () => this.tryDripAPI(),
                () => this.tryCollectionScraping()
            ];

            for (const method of methods) {
                try {
                    const sales = await method();
                    if (sales && sales.length > 0) {
                        await this.processAPISales(sales);
                        return;
                    }
                } catch (error) {
                    // Continue to next method
                }
            }
        } catch (error) {
            console.error('❌ API monitoring error:', error);
        }
    }

    async tryDripAPI() {
        const endpoints = [
            `/api/collections/tenshis/activity`,
            `/api/collections/tenshis/sales`,
            `/api/v1/collections/tenshis/recent`
        ];

        for (const endpoint of endpoints) {
            try {
                const response = await axios.get(`${CONFIG.DRIP_BASE_URL}${endpoint}`, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (compatible; TenshiBot/1.0)',
                    },
                    timeout: 10000
                });

                if (response.data && Array.isArray(response.data)) {
                    return this.parseAPIResponse(response.data);
                }
            } catch (error) {
                // Continue
            }
        }

        throw new Error('No API endpoints found');
    }

    async tryCollectionScraping() {
        const url = `${CONFIG.DRIP_BASE_URL}/collections/tenshis`;
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        const jsonPatterns = [
            /window\.__INITIAL_STATE__\s*=\s*({.*?});/s,
            /"sales":\s*(\[.*?\])/s,
            /"activity":\s*(\[.*?\])/s
        ];

        for (const pattern of jsonPatterns) {
            const match = response.data.match(pattern);
            if (match) {
                try {
                    const data = JSON.parse(match[1]);
                    const sales = this.extractSalesFromData(data);
                    if (sales.length > 0) {
                        return sales;
                    }
                } catch (e) {
                    // Continue
                }
            }
        }

        throw new Error('No sales data found');
    }

    parseAPIResponse(data) {
        return data.map(item => ({
            tokenId: item.token_id || item.tokenId || item.id,
            price: this.formatPrice(item.price || item.sale_price || item.amount),
            seller: item.seller || item.from_address || item.from,
            buyer: item.buyer || item.to_address || item.to,
            timestamp: item.timestamp || item.created_at || Date.now(),
            txHash: item.transaction_hash || item.txHash,
            source: 'api'
        })).filter(sale => sale.tokenId && sale.price);
    }

    extractSalesFromData(data) {
        const findSales = (obj) => {
            if (Array.isArray(obj)) {
                return obj.filter(item => 
                    item && typeof item === 'object' && 
                    (item.tokenId || item.token_id) && 
                    (item.price || item.sale_price)
                );
            }

            if (obj && typeof obj === 'object') {
                for (const [key, value] of Object.entries(obj)) {
                    if (key.includes('sale') || key.includes('activity')) {
                        const sales = findSales(value);
                        if (sales.length > 0) return sales;
                    }
                }
            }

            return [];
        };

        return findSales(data);
    }

    async processAPISales(sales) {
        let newSalesCount = 0;

        for (const sale of sales) {
            const saleId = this.generateSaleId(sale);
            
            if (!this.lastSeenSales.has(saleId)) {
                console.log(`🎉 API sale: Tenshis #${sale.tokenId} for ${sale.price}`);
                
                try {
                    await this.postSaleToDiscord(sale);
                    this.lastSeenSales.add(saleId);
                    newSalesCount++;
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`❌ Failed to post sale ${sale.tokenId}:`, error);
                }
            }
        }

        if (newSalesCount > 0) {
            console.log(`✅ Posted ${newSalesCount} new sales`);
        }

        // Memory management
        if (this.lastSeenSales.size > 1000) {
            const oldSales = Array.from(this.lastSeenSales).slice(0, 500);
            this.lastSeenSales = new Set(oldSales);
        }
    }

    formatPrice(price) {
        if (!price) return 'Unknown';
        
        if (typeof price === 'string') {
            return price.includes('HYPE') ? price : `${price} HYPE`;
        }
        
        return `${price} HYPE`;
    }

    generateSaleId(sale) {
        return `${sale.tokenId}-${sale.price}-${sale.timestamp || Date.now()}`;
    }

    async postSaleToDiscord(sale) {
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

        const sourceIcon = sale.source === 'blockchain' ? '⛓️' : '🌐';
        embed.setFooter({
            text: `${sourceIcon} Detected via ${sale.source}`,
            iconURL: 'https://drip.trade/favicon.ico'
        });

        try {
            const metadata = await this.getTokenMetadata(sale.tokenId);
            if (metadata && metadata.image) {
                embed.setThumbnail(metadata.image);
            }
        } catch (e) {
            // Continue without image
        }

        await channel.send({ embeds: [embed] });
    }

    async getTokenMetadata(tokenId) {
        try {
            const tokenURI = await this.tenshisContract.tokenURI(tokenId);
            
            if (tokenURI.startsWith('http')) {
                const response = await axios.get(tokenURI, { timeout: 5000 });
                return response.data;
            } else if (tokenURI.startsWith('ipfs://')) {
                const ipfsHash = tokenURI.replace('ipfs://', '');
                const httpUri = `https://ipfs.io/ipfs/${ipfsHash}`;
                const response = await axios.get(httpUri, { timeout: 5000 });
                return response.data;
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    shortenAddress(address) {
        if (!address || address.length < 10) return address || 'Unknown';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
}

// Health check server for Railway
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot: 'Tenshis Sales Monitor',
        tenshisContract: CONFIG.TENSHIS_CONTRACT_ADDRESS,
        marketplaceContract: CONFIG.DRIP_MARKETPLACE_ADDRESS || 'auto-discovering',
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
    console.log('🚀 Starting Tenshis Sales Bot...');
    console.log('🔒 All secrets loaded from environment variables (secure!)');
    
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
