const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { ethers } = require('ethers');
const axios = require('axios');

// 🎯 WORKING CONFIGURATION
const CONFIG = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CHANNEL_ID: process.env.CHANNEL_ID,
    
    // Hyperliquid blockchain
    RPC_URL: 'https://rpc.hyperliquid.xyz/evm',
    TENSHIS_CONTRACT: '0x2420DB6CF531F932ee77F4A0912A60C31251c793',
    
    // Monitoring settings
    CHECK_INTERVAL: 15000, // Check every 15 seconds
    BLOCK_LOOKBACK: 100,   // Check last 100 blocks each time
    
    // Testing
    TEST_MODE: process.env.TEST_MODE === 'true',
    TEST_INTERVAL: 45000, // Test sale every 45 seconds
    
    // URLs
    DRIP_BASE_URL: 'https://drip.trade',
    HYPERLIQUID_EXPLORER: 'https://hyperliquid.cloud.blockscout.com'
};

class WorkingTenshisBot {
    constructor() {
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
        });
        
        this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
        this.lastProcessedBlock = 0;
        this.lastSeenTransfers = new Set();
        this.isRunning = false;
        this.salesCount = 0;
        this.checkCount = 0;
        this.startTime = new Date();
        
        console.log('🎯 Working Tenshis Sales Bot initialized');
        console.log(`📋 Contract: ${CONFIG.TENSHIS_CONTRACT}`);
        console.log(`⏱️ Check interval: ${CONFIG.CHECK_INTERVAL / 1000}s`);
    }

    async initialize() {
        try {
            // Validate environment
            if (!CONFIG.DISCORD_TOKEN || !CONFIG.CHANNEL_ID) {
                throw new Error('❌ Missing required environment variables');
            }

            console.log('🔒 Environment validated');
            
            // Connect to Discord
            await this.client.login(CONFIG.DISCORD_TOKEN);
            console.log('✅ Discord bot connected');

            // Test blockchain connection
            await this.testBlockchainConnection();

            // Send startup message
            await this.sendStartupMessage();
            
            // Start monitoring
            this.startMonitoring();
            
            // Set up health monitoring
            this.setupHealthMonitoring();
            
            // Enable test mode if requested
            if (CONFIG.TEST_MODE) {
                this.setupTestMode();
            }
            
        } catch (error) {
            console.error('❌ Failed to initialize:', error.message);
            process.exit(1);
        }
    }

    async testBlockchainConnection() {
        try {
            console.log('🔗 Testing Hyperliquid blockchain connection...');
            
            const currentBlock = await this.provider.getBlockNumber();
            const network = await this.provider.getNetwork();
            
            console.log(`✅ Connected to Hyperliquid (Chain ID: ${network.chainId})`);
            console.log(`📦 Current block: ${currentBlock}`);
            
            this.lastProcessedBlock = currentBlock;
            
        } catch (error) {
            console.error('❌ Blockchain connection failed:', error.message);
            throw error;
        }
    }

    async sendStartupMessage() {
        try {
            const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
            
            const embed = new EmbedBuilder()
                .setTitle('🎯 Working Tenshis Bot Online!')
                .setColor(0x7C3AED)
                .setDescription('Monitoring Tenshis NFT transfers with proven blockchain polling')
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
                        name: '⏱️ Check Interval',
                        value: `${CONFIG.CHECK_INTERVAL / 1000}s`,
                        inline: true
                    },
                    {
                        name: '📦 Block Lookback',
                        value: `${CONFIG.BLOCK_LOOKBACK} blocks`,
                        inline: true
                    },
                    {
                        name: '🛠️ Method',
                        value: 'Optimized Blockchain Polling',
                        inline: true
                    },
                    {
                        name: '🧪 Test Mode',
                        value: CONFIG.TEST_MODE ? 'ON' : 'OFF',
                        inline: true
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: CONFIG.TEST_MODE ? 'Test sales will appear every 45s' : 'Ready to detect sales!'
                });

            await channel.send({ embeds: [embed] });
            console.log('📢 Startup message sent');
            
        } catch (error) {
            console.error('❌ Failed to send startup message:', error);
        }
    }

    startMonitoring() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log(`🔍 Started monitoring every ${CONFIG.CHECK_INTERVAL / 1000} seconds`);
        
        // Initial check after 5 seconds
        setTimeout(() => {
            this.checkForTransfers();
        }, 5000);
        
        // Regular monitoring
        setInterval(() => {
            this.checkForTransfers();
        }, CONFIG.CHECK_INTERVAL);
    }

    async checkForTransfers() {
        this.checkCount++;
        const timestamp = new Date().toISOString();
        
        console.log(`🔍 [${timestamp}] Check #${this.checkCount} - Scanning for Tenshis transfers...`);
        
        try {
            const currentBlock = await this.provider.getBlockNumber();
            
            // Calculate block range
            const fromBlock = Math.max(
                this.lastProcessedBlock + 1,
                currentBlock - CONFIG.BLOCK_LOOKBACK
            );
            const toBlock = currentBlock;
            
            if (fromBlock > toBlock) {
                console.log(`📭 No new blocks to scan`);
                return;
            }
            
            console.log(`📦 Scanning blocks ${fromBlock} to ${toBlock} (${toBlock - fromBlock + 1} blocks)`);

            // Get Transfer events for Tenshis contract
            const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
            
            const logs = await this.provider.getLogs({
                address: CONFIG.TENSHIS_CONTRACT,
                topics: [transferEventSignature],
                fromBlock,
                toBlock
            });

            console.log(`📋 Found ${logs.length} Transfer events`);

            if (logs.length > 0) {
                await this.processTransferEvents(logs);
            } else {
                console.log(`📭 No transfers found in scanned blocks`);
            }

            this.lastProcessedBlock = currentBlock;
            console.log(`✅ [${timestamp}] Check #${this.checkCount} completed successfully`);
            
        } catch (error) {
            console.error(`❌ [${timestamp}] Check #${this.checkCount} failed:`, error.message);
        }
    }

    async processTransferEvents(logs) {
        console.log(`🔄 Processing ${logs.length} transfer events...`);
        
        let newSales = 0;

        for (const log of logs) {
            try {
                console.log(`🔍 Processing log: ${JSON.stringify({
                    address: log.address,
                    topics: log.topics,
                    data: log.data,
                    blockNumber: log.blockNumber,
                    txHash: log.transactionHash
                })}`);

                // Decode Transfer event - handle both indexed and non-indexed versions
                let from, to, tokenId;
                
                if (log.topics.length >= 4) {
                    // Standard ERC-721: Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
                    from = ethers.getAddress('0x' + log.topics[1].slice(26)); // Remove padding
                    to = ethers.getAddress('0x' + log.topics[2].slice(26));   // Remove padding
                    tokenId = BigInt(log.topics[3]).toString();              // TokenId from topics
                    console.log(`📋 Decoded from topics: from=${from}, to=${to}, tokenId=${tokenId}`);
                } else if (log.data && log.data !== '0x' && log.data.length > 2) {
                    // Non-standard format - try to decode from data
                    try {
                        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                            ['address', 'address', 'uint256'],
                            log.data
                        );
                        [from, to, tokenId] = [decoded[0], decoded[1], decoded[2].toString()];
                        console.log(`📋 Decoded from data: from=${from}, to=${to}, tokenId=${tokenId}`);
                    } catch (dataError) {
                        console.log(`⚠️ Could not decode from data, trying topics...`);
                        if (log.topics.length >= 3) {
                            from = '0x' + log.topics[1].slice(26);
                            to = '0x' + log.topics[2].slice(26);
                            tokenId = log.topics[3] ? BigInt(log.topics[3]).toString() : 'Unknown';
                            console.log(`📋 Decoded from topics (fallback): from=${from}, to=${to}, tokenId=${tokenId}`);
                        } else {
                            throw new Error(`Cannot decode transfer event: insufficient topics and data`);
                        }
                    }
                } else {
                    throw new Error(`Transfer event has no usable data: topics=${log.topics.length}, data=${log.data}`);
                }
                
                // Skip minting (from 0x0)
                if (from === '0x0000000000000000000000000000000000000000') {
                    console.log(`⚪ Skipping mint: Tenshis #${tokenId}`);
                    continue;
                }

                const transferData = {
                    tokenId: tokenId,
                    from,
                    to,
                    blockNumber: log.blockNumber,
                    txHash: log.transactionHash,
                    logIndex: log.logIndex
                };

                const transferId = this.generateTransferId(transferData);
                
                if (!this.lastSeenTransfers.has(transferId)) {
                    console.log(`🔄 NEW TRANSFER: Tenshis #${transferData.tokenId} (Block ${transferData.blockNumber})`);
                    console.log(`   From: ${this.shortenAddress(from)} → To: ${this.shortenAddress(to)}`);
                    
                    // Analyze if this is a potential sale
                    const saleInfo = await this.analyzePotentialSale(transferData);
                    
                    if (saleInfo.isSale) {
                        newSales++;
                        console.log(`🎉 SALE DETECTED: Tenshis #${transferData.tokenId}`);
                        console.log(`   Confidence: ${saleInfo.confidence}%`);
                        console.log(`   Price: ${saleInfo.price || 'Unknown'}`);
                        
                        const enrichedSale = {
                            ...transferData,
                            ...saleInfo,
                            timestamp: Date.now()
                        };
                        
                        await this.postSaleToDiscord(enrichedSale);
                        this.salesCount++;
                    } else {
                        console.log(`📋 Regular transfer (confidence: ${saleInfo.confidence}%)`);
                    }
                    
                    this.lastSeenTransfers.add(transferId);
                    
                    // Small delay between processing
                    await new Promise(resolve => setTimeout(resolve, 100));
                } else {
                    console.log(`📋 Already processed: ${transferId}`);
                }
                
            } catch (error) {
                console.error(`❌ Error processing transfer:`, error.message);
                console.error(`❌ Log details:`, JSON.stringify(log, null, 2));
                // Continue processing other events instead of failing
                continue;
            }
        }

        if (newSales > 0) {
            console.log(`✅ Detected and posted ${newSales} sales`);
        }

        // Memory cleanup
        if (this.lastSeenTransfers.size > 1000) {
            const oldTransfers = Array.from(this.lastSeenTransfers).slice(0, 500);
            this.lastSeenTransfers = new Set(oldTransfers);
            console.log('🧹 Cleaned up old transfers from memory');
        }
    }

    async analyzePotentialSale(transferData) {
        try {
            console.log(`🔍 Analyzing TX ${transferData.txHash.slice(0, 10)}... for sale indicators`);
            
            const tx = await this.provider.getTransaction(transferData.txHash);
            const receipt = await this.provider.getTransactionReceipt(transferData.txHash);
            
            const analysis = {
                isSale: false,
                price: null,
                marketplace: null,
                confidence: 0
            };

            // Factor 1: Transaction has value (payment included)
            if (tx.value && tx.value > 0) {
                analysis.price = `${ethers.formatEther(tx.value)} HYPE`;
                analysis.confidence += 40;
                console.log(`   💰 Payment included: ${analysis.price} (+40%)`);
            }

            // Factor 2: Transaction involves marketplace contract
            if (tx.to && tx.to !== CONFIG.TENSHIS_CONTRACT && tx.to !== transferData.from) {
                const code = await this.provider.getCode(tx.to);
                if (code !== '0x') {
                    analysis.marketplace = tx.to;
                    analysis.confidence += 30;
                    console.log(`   🏪 Via marketplace: ${this.shortenAddress(tx.to)} (+30%)`);
                }
            }

            // Factor 3: Multiple events in transaction (marketplace complexity)
            if (receipt.logs.length > 2) {
                analysis.confidence += 15;
                console.log(`   📋 Complex transaction: ${receipt.logs.length} events (+15%)`);
            }

            // Factor 4: High gas usage (marketplace transactions)
            if (receipt.gasUsed > 80000) {
                analysis.confidence += 15;
                console.log(`   ⛽ High gas usage: ${receipt.gasUsed} (+15%)`);
            }

            // Determine if it's likely a sale (lowered threshold for sensitivity)
            if (analysis.confidence >= 30) {
                analysis.isSale = true;
                console.log(`   ✅ LIKELY SALE (${analysis.confidence}% confidence)`);
            } else {
                console.log(`   📊 Probably transfer (${analysis.confidence}% confidence)`);
            }

            return analysis;
            
        } catch (error) {
            console.error(`❌ Error analyzing transaction:`, error.message);
            return { isSale: false, price: null, marketplace: null, confidence: 0 };
        }
    }

    async postSaleToDiscord(saleData) {
        try {
            console.log(`📤 Posting Tenshis #${saleData.tokenId} sale to Discord...`);
            
            const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
            
            const embed = new EmbedBuilder()
                .setTitle(`${saleData.isTest ? '🧪 TEST: ' : '🎉 '}Tenshis #${saleData.tokenId} Sale Detected!`)
                .setColor(saleData.isTest ? 0xffaa00 : 0x7C3AED)
                .setTimestamp()
                .addFields(
                    {
                        name: '🆔 Token ID',
                        value: saleData.tokenId,
                        inline: true
                    },
                    {
                        name: '💰 Price',
                        value: saleData.price || 'Unknown',
                        inline: true
                    },
                    {
                        name: '📊 Confidence',
                        value: `${saleData.confidence || 100}%`,
                        inline: true
                    },
                    {
                        name: '👤 From',
                        value: `\`${this.shortenAddress(saleData.from)}\``,
                        inline: true
                    },
                    {
                        name: '🛒 To',
                        value: `\`${this.shortenAddress(saleData.to)}\``,
                        inline: true
                    },
                    {
                        name: '📦 Block',
                        value: saleData.blockNumber ? saleData.blockNumber.toString() : 'Test',
                        inline: true
                    }
                );

            // Add transaction link
            if (saleData.txHash && !saleData.isTest) {
                embed.addFields({
                    name: '🔗 Transaction',
                    value: `[View on Explorer](${CONFIG.HYPERLIQUID_EXPLORER}/tx/${saleData.txHash})`,
                    inline: true
                });
            }

            // Add marketplace link
            if (!saleData.isTest) {
                embed.addFields({
                    name: '🏪 Marketplace',
                    value: `[View on Drip.Trade](${CONFIG.DRIP_BASE_URL}/collections/tenshis/${saleData.tokenId})`,
                    inline: true
                });
            }

            // Add marketplace contract if detected
            if (saleData.marketplace) {
                embed.addFields({
                    name: '🏪 Marketplace Contract',
                    value: `\`${this.shortenAddress(saleData.marketplace)}\``,
                    inline: true
                });
            }

            embed.setFooter({
                text: saleData.isTest ? 
                    `🧪 Test Sale #${this.salesCount} • Testing System` : 
                    `⛓️ Blockchain Detection • Check #${this.checkCount}`,
                iconURL: 'https://drip.trade/favicon.ico'
            });

            await channel.send({ embeds: [embed] });
            console.log(`✅ Posted Tenshis #${saleData.tokenId} sale to Discord`);
            
        } catch (error) {
            console.error('❌ Error posting to Discord:', error);
        }
    }

    setupTestMode() {
        console.log('🧪 TEST MODE ENABLED - Simulating sales every 45 seconds');
        
        let testNumber = 1;
        
        setInterval(async () => {
            try {
                const testSale = {
                    tokenId: (2000 + testNumber).toString(),
                    price: `${(Math.random() * 1.5 + 0.2).toFixed(3)} HYPE`,
                    from: '0x' + Math.random().toString(16).substring(2, 42),
                    to: '0x' + Math.random().toString(16).substring(2, 42),
                    txHash: '0x' + Math.random().toString(16).substring(2, 66),
                    confidence: 85,
                    marketplace: '0x' + Math.random().toString(16).substring(2, 42),
                    timestamp: Date.now(),
                    isTest: true
                };

                console.log(`🧪 SIMULATING TEST SALE: Tenshis #${testSale.tokenId} for ${testSale.price}`);
                
                await this.postSaleToDiscord(testSale);
                this.salesCount++;
                testNumber++;
                
            } catch (error) {
                console.error('❌ Test sale simulation failed:', error);
            }
        }, CONFIG.TEST_INTERVAL);
    }

    setupHealthMonitoring() {
        // Health check every 12 hours
        setInterval(async () => {
            const uptime = Math.floor((Date.now() - this.startTime) / 1000 / 60);
            console.log(`💓 Health: ${uptime}min uptime, ${this.checkCount} checks, ${this.salesCount} sales detected`);
            
            try {
                const currentBlock = await this.provider.getBlockNumber();
                const channel = await this.client.channels.fetch(CONFIG.CHANNEL_ID);
                
                const embed = new EmbedBuilder()
                    .setTitle('💓 Tenshis Bot Health Check')
                    .setColor(0x00ff00)
                    .addFields(
                        {
                            name: '⏱️ Uptime',
                            value: `${uptime} minutes`,
                            inline: true
                        },
                        {
                            name: '🔍 Checks Completed',
                            value: this.checkCount.toString(),
                            inline: true
                        },
                        {
                            name: '🎉 Sales Detected',
                            value: this.salesCount.toString(),
                            inline: true
                        },
                        {
                            name: '📦 Current Block',
                            value: currentBlock.toString(),
                            inline: true
                        },
                        {
                            name: '📍 Last Processed',
                            value: this.lastProcessedBlock.toString(),
                            inline: true
                        },
                        {
                            name: '🧪 Test Mode',
                            value: CONFIG.TEST_MODE ? 'Active' : 'Off',
                            inline: true
                        }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Automated health monitoring • Every 12 hours' });

                await channel.send({ embeds: [embed] });
                
            } catch (error) {
                console.error('❌ Health check failed:', error);
            }
        }, 12 * 60 * 60 * 1000); // 12 hours = 12 * 60 * 60 * 1000 milliseconds
    }
    }

    generateTransferId(transfer) {
        return `${transfer.txHash}-${transfer.logIndex}`;
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
        bot: 'Working Tenshis Sales Monitor',
        method: 'Optimized blockchain polling',
        contract: CONFIG.TENSHIS_CONTRACT,
        checkInterval: `${CONFIG.CHECK_INTERVAL / 1000}s`,
        testMode: CONFIG.TEST_MODE,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        method: 'blockchain-polling',
        timestamp: new Date().toISOString() 
    });
});

// Main function
async function main() {
    console.log('🚀 Starting Working Tenshis Sales Bot...');
    
    // Start health server
    app.listen(PORT, () => {
        console.log(`🌐 Health server running on port ${PORT}`);
    });
    
    // Start bot
    const bot = new WorkingTenshisBot();
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

module.exports = { WorkingTenshisBot };
