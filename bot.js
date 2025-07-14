const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { ethers } = require('ethers');
const axios = require('axios');

// 🔒 SAFE CONFIGURATION
const CONFIG = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CHANNEL_ID: process.env.CHANNEL_ID,
    
    // Blockchain configuration
    RPC_URL: 'https://rpc.hyperliquid.xyz/evm',
    TENSHIS_CONTRACT_ADDRESS: '0x2420DB6CF531F932ee77F4A0912A60C31251c793',
    
    // Monitoring configuration
    POLLING_INTERVAL: parseInt(process.env.POLLING_INTERVAL) || 30000, // 30 seconds
    BLOCK_RANGE: 1000, // Check last 1000 blocks for transfers
    
    // URLs
    DRIP_BASE_URL: 'https://drip.trade',
    HYPERLIQUID_EXPLORER: 'https://hyperliquid.cloud.blockscout.com'
};

class TenshisBlockchainBot {
    constructor() {
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
        });
        
        this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
        this.lastProcessedBlock = 0;
        this.lastSeenTransfers = new Set();
        this.isRunning = false;
        this.monitoringCount = 0;
        this.startTime = new Date();
        
        console.log('🤖 Tenshis Blockchain Sales Bot initialized');
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

            // Verify blockchain connection
            await this.verifyBlockchainConnection();

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

    async verifyBlockchainConnection() {
        try {
            console.log('🔗 Verifying Hyperliquid blockchain connection...');
            
            const currentBlock = await this.provider.getBlockNumber();
            const networkInfo = await this.provider.getNetwork();
            
            console.log(`✅ Connected to Hyperliquid (Chain ID: ${networkInfo.chainId})`);
            console.log(`📦 Current block: ${currentBlock}`);
            
            // Test Tenshis contract
            const tenshisContract = new ethers.Contract(
                CONFIG.TENSHIS_CONTRACT_ADDRESS,
                ['function name() view returns (string)', 'function symbol() view returns (string)'],
                this.provider
            );

            const name = await tenshisContract.name();
            const symbol = await tenshisContract.symbol();
            console.log(`✅ Tenshis contract verified: ${name} (${symbol})`);
            
        } catch (error) {
            console.error('❌ Blockchain connection failed:', error.message);
            throw error;
        }
    }

    async sendStartupMessage() {
        try {
            const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
            
            const embed = new EmbedBuilder()
                .setTitle('🔗 Tenshis Blockchain Bot Online!')
                .setColor(0x7C3AED)
                .setDescription('Now monitoring Tenshis NFT transfers directly on Hyperliquid blockchain')
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
                        name: '⛓️ Method',
                        value: 'Direct Blockchain Monitoring',
                        inline: true
                    },
                    {
                        name: '📦 Block Range',
                        value: `${CONFIG.BLOCK_RANGE} blocks`,
                        inline: true
                    },
                    {
                        name: '🌐 Explorer',
                        value: `[Hyperliquid](${CONFIG.HYPERLIQUID_EXPLORER})`,
                        inline: true
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Monitoring blockchain transfers!' });

            await channel.send({ embeds: [embed] });
            console.log('📢 Startup message sent to Discord');
            
        } catch (error) {
            console.error('❌ Failed to send startup message:', error);
            throw error;
        }
    }

    startMonitoring() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log(`🔍 Started blockchain monitoring every ${CONFIG.POLLING_INTERVAL / 1000} seconds`);
        
        // Initial check after 5 seconds
        setTimeout(() => {
            this.checkBlockchainTransfers();
        }, 5000);
        
        // Regular monitoring
        setInterval(() => {
            this.checkBlockchainTransfers();
        }, CONFIG.POLLING_INTERVAL);

        // Health check every 10 minutes
        setInterval(() => {
            this.sendHealthCheck();
        }, 10 * 60 * 1000);
    }

    async checkBlockchainTransfers() {
        this.monitoringCount++;
        const timestamp = new Date().toISOString();
        
        console.log(`🔍 [${timestamp}] Blockchain check #${this.monitoringCount} - Scanning for Tenshis transfers...`);
        
        try {
            const currentBlock = await this.provider.getBlockNumber();
            console.log(`📦 Current block: ${currentBlock}, Last processed: ${this.lastProcessedBlock}`);
            
            if (currentBlock <= this.lastProcessedBlock) {
                console.log(`📭 No new blocks since last check`);
                return;
            }

            // Calculate block range to scan
            const fromBlock = Math.max(this.lastProcessedBlock + 1, currentBlock - CONFIG.BLOCK_RANGE);
            const toBlock = currentBlock;
            
            console.log(`🔎 Scanning blocks ${fromBlock} to ${toBlock} for Tenshis transfers...`);

            // Get Transfer events from Tenshis contract
            const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
            
            const logs = await this.provider.getLogs({
                address: CONFIG.TENSHIS_CONTRACT_ADDRESS,
                topics: [transferEventSignature],
                fromBlock,
                toBlock
            });

            console.log(`📋 Found ${logs.length} Transfer events in scanned blocks`);

            if (logs.length > 0) {
                await this.processTransferEvents(logs);
            } else {
                console.log(`📭 No transfers found in blocks ${fromBlock}-${toBlock}`);
            }

            this.lastProcessedBlock = currentBlock;
            console.log(`✅ [${timestamp}] Blockchain check #${this.monitoringCount} completed successfully`);
            
        } catch (error) {
            console.error(`❌ [${timestamp}] Blockchain check #${this.monitoringCount} failed:`, error.message);
            
            // Send error notification
            try {
                await this.sendErrorNotification(error);
            } catch (discordError) {
                console.error('❌ Could not send error notification:', discordError.message);
            }
        }
    }

    async processTransferEvents(logs) {
        console.log(`🔄 Processing ${logs.length} transfer events...`);
        
        let potentialSales = 0;

        for (const log of logs) {
            try {
                // Decode the Transfer event
                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                    ['address', 'address', 'uint256'],
                    log.data
                );
                
                const [from, to, tokenId] = decoded;
                
                // Skip minting transfers (from 0x0)
                if (from === '0x0000000000000000000000000000000000000000') {
                    console.log(`⚪ Skipping mint: Tenshis #${tokenId.toString()}`);
                    continue;
                }

                // This could be a sale! 
                const transferData = {
                    tokenId: tokenId.toString(),
                    from,
                    to,
                    blockNumber: log.blockNumber,
                    txHash: log.transactionHash,
                    logIndex: log.logIndex
                };

                const transferId = this.generateTransferId(transferData);
                
                if (!this.lastSeenTransfers.has(transferId)) {
                    console.log(`🔄 NEW TRANSFER: Tenshis #${transferData.tokenId} from ${this.shortenAddress(from)} to ${this.shortenAddress(to)}`);
                    
                    // Get transaction details to determine if it's a sale
                    const saleInfo = await this.analyzePotentialSale(transferData);
                    
                    if (saleInfo.isSale) {
                        potentialSales++;
                        console.log(`🎉 SALE DETECTED: Tenshis #${transferData.tokenId} for ${saleInfo.price || 'Unknown price'}`);
                        await this.postSaleToDiscord(transferData, saleInfo);
                    } else {
                        console.log(`🔄 Regular transfer: Tenshis #${transferData.tokenId} (not a marketplace sale)`);
                    }
                    
                    this.lastSeenTransfers.add(transferId);
                    
                    // Small delay between processing
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
            } catch (error) {
                console.error(`❌ Error processing transfer event:`, error.message);
            }
        }

        if (potentialSales > 0) {
            console.log(`✅ Detected and posted ${potentialSales} sales to Discord`);
        }

        // Memory management
        if (this.lastSeenTransfers.size > 1000) {
            const oldTransfers = Array.from(this.lastSeenTransfers).slice(0, 500);
            this.lastSeenTransfers = new Set(oldTransfers);
            console.log('🧹 Cleaned up old transfers from memory');
        }
    }

    async analyzePotentialSale(transferData) {
        try {
            console.log(`🔍 Analyzing transaction ${transferData.txHash} for sale indicators...`);
            
            // Get transaction details
            const tx = await this.provider.getTransaction(transferData.txHash);
            const receipt = await this.provider.getTransactionReceipt(transferData.txHash);
            
            // Analysis factors
            const analysis = {
                isSale: false,
                price: null,
                marketplace: null,
                confidence: 0
            };

            // Factor 1: Transaction has value (ETH/HYPE payment)
            if (tx.value && tx.value > 0) {
                analysis.price = `${ethers.formatEther(tx.value)} HYPE`;
                analysis.confidence += 30;
                console.log(`💰 Transaction includes payment: ${analysis.price}`);
            }

            // Factor 2: Transaction to a contract (not direct user-to-user)
            if (tx.to && tx.to !== CONFIG.TENSHIS_CONTRACT_ADDRESS) {
                const code = await this.provider.getCode(tx.to);
                if (code !== '0x') {
                    analysis.marketplace = tx.to;
                    analysis.confidence += 40;
                    console.log(`🏪 Transaction involves marketplace contract: ${tx.to}`);
                }
            }

            // Factor 3: Multiple events in transaction (typical of marketplace sales)
            if (receipt.logs.length > 1) {
                analysis.confidence += 20;
                console.log(`📋 Transaction has ${receipt.logs.length} events (marketplace-like)`);
            }

            // Factor 4: Gas usage pattern (marketplace transactions use more gas)
            const gasUsed = receipt.gasUsed;
            if (gasUsed > 100000) { // High gas usage suggests complex transaction
                analysis.confidence += 10;
                console.log(`⛽ High gas usage: ${gasUsed} (marketplace-like)`);
            }

            // Determine if it's likely a sale
            if (analysis.confidence >= 50) {
                analysis.isSale = true;
                console.log(`✅ High confidence (${analysis.confidence}%) this is a marketplace sale`);
            } else {
                console.log(`📊 Low confidence (${analysis.confidence}%) - likely direct transfer`);
            }

            return analysis;
            
        } catch (error) {
            console.error(`❌ Error analyzing transaction:`, error.message);
            return { isSale: false, price: null, marketplace: null, confidence: 0 };
        }
    }

    generateTransferId(transfer) {
        return `${transfer.txHash}-${transfer.logIndex}`;
    }

    async postSaleToDiscord(transferData, saleInfo) {
        console.log(`📤 Posting Tenshis #${transferData.tokenId} sale to Discord...`);
        
        const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
        
        const embed = new EmbedBuilder()
            .setTitle(`🎉 Tenshis #${transferData.tokenId} Sale Detected!`)
            .setColor(0x7C3AED)
            .setTimestamp()
            .addFields(
                {
                    name: '🆔 Token ID',
                    value: transferData.tokenId,
                    inline: true
                },
                {
                    name: '💰 Price',
                    value: saleInfo.price || 'Unknown',
                    inline: true
                },
                {
                    name: '📊 Confidence',
                    value: `${saleInfo.confidence}%`,
                    inline: true
                },
                {
                    name: '👤 From',
                    value: `\`${this.shortenAddress(transferData.from)}\``,
                    inline: true
                },
                {
                    name: '🛒 To',
                    value: `\`${this.shortenAddress(transferData.to)}\``,
                    inline: true
                },
                {
                    name: '📦 Block',
                    value: transferData.blockNumber.toString(),
                    inline: true
                }
            );

        embed.addFields(
            {
                name: '🔗 Transaction',
                value: `[View on Explorer](${CONFIG.HYPERLIQUID_EXPLORER}/tx/${transferData.txHash})`,
                inline: true
            },
            {
                name: '🏪 NFT Details',
                value: `[View on Drip.Trade](${CONFIG.DRIP_BASE_URL}/collections/tenshis/${transferData.tokenId})`,
                inline: true
            }
        );

        if (saleInfo.marketplace) {
            embed.addFields({
                name: '🏪 Marketplace',
                value: `\`${this.shortenAddress(saleInfo.marketplace)}\``,
                inline: true
            });
        }

        embed.setFooter({
            text: `⛓️ Detected via blockchain • Check #${this.monitoringCount}`,
            iconURL: 'https://drip.trade/favicon.ico'
        });

        await channel.send({ embeds: [embed] });
        console.log(`✅ Successfully posted Tenshis #${transferData.tokenId} sale to Discord`);
    }

    async sendHealthCheck() {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000 / 60); // minutes
        console.log(`💓 Health check: Bot running ${uptime}min, completed ${this.monitoringCount} blockchain checks`);
        
        try {
            const currentBlock = await this.provider.getBlockNumber();
            const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
            
            const embed = new EmbedBuilder()
                .setTitle('💓 Blockchain Bot Health Check')
                .setColor(0x00ff00)
                .addFields(
                    {
                        name: '⏱️ Uptime',
                        value: `${uptime} minutes`,
                        inline: true
                    },
                    {
                        name: '🔍 Checks',
                        value: `${this.monitoringCount}`,
                        inline: true
                    },
                    {
                        name: '📦 Current Block',
                        value: currentBlock.toString(),
                        inline: true
                    },
                    {
                        name: '🔄 Transfers Seen',
                        value: `${this.lastSeenTransfers.size}`,
                        inline: true
                    },
                    {
                        name: '📍 Last Processed',
                        value: this.lastProcessedBlock.toString(),
                        inline: true
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Blockchain monitoring active' });

            await channel.send({ embeds: [embed] });
            
        } catch (error) {
            console.error('❌ Health check failed:', error.message);
        }
    }

    async sendErrorNotification(error) {
        try {
            const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
            
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Blockchain Monitoring Error')
                .setColor(0xff9900)
                .setDescription('Bot encountered an error but will continue monitoring')
                .addFields({
                    name: '❌ Error',
                    value: `\`\`\`${error.message.slice(0, 1000)}\`\`\``,
                    inline: false
                })
                .setTimestamp()
                .setFooter({ text: 'Error notification' });

            await channel.send({ embeds: [embed] });
        } catch (discordError) {
            console.error('❌ Failed to send error notification:', discordError.message);
        }
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
        bot: 'Tenshis Blockchain Sales Monitor',
        method: 'Direct blockchain monitoring',
        tenshisContract: CONFIG.TENSHIS_CONTRACT_ADDRESS,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        method: 'blockchain',
        timestamp: new Date().toISOString() 
    });
});

// Main function
async function main() {
    console.log('🚀 Starting Tenshis Blockchain Sales Bot...');
    
    // Start health server
    app.listen(PORT, () => {
        console.log(`🌐 Health server running on port ${PORT}`);
    });
    
    // Start bot
    const bot = new TenshisBlockchainBot();
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

module.exports = { TenshisBlockchainBot };
