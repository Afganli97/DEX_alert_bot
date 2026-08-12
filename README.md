# DEX Alert Bot

A multi-user Telegram bot that monitors token prices via DexScreener and GeckoTerminal APIs.

## Features

- **Multi-user support**: Each user can manage their own token alerts independently
- **Price monitoring**: Real-time price tracking for EVM and Solana tokens
- **Alert system**: Configurable percentage-based price change alerts
- **Telegram integration**: Webhook-based message handling
- **Rate limiting**: Built-in rate limiting to prevent abuse
- **Admin panel**: Administrative commands for user management and statistics

## Commands

### User Commands
- `/start` - Start the bot and show help
- `/help` - Display available commands
- `/add` - Add a new token to monitor
- `/list` - Show your monitored tokens
- `/remove` - Remove a token from monitoring
- `/change` - Change alert threshold for a single token
- `/change_all` - Change alert threshold for all tokens
- `/reset_anchors` - Reset baseline prices for all tokens
- `/cancel` - Cancel current operation
- `/stop` - Unsubscribe from all alerts and delete data
- `/delete_my_data` - Delete all your data
- `/privacy` - Show privacy policy

### Admin Commands
- `/broadcast` - Send message to all active users (admin only)
- `/admin stats` - Show bot statistics
- `/admin block_user <chatId>` - Block a user
- `/admin unblock_user <chatId>` - Unblock a user
- `/admin reset_all_anchors` - Reset all baseline prices
- `/admin view_user <chatId>` - View user information

## Installation

1. Clone the repository
2. Copy `.env.template` to `.env` and fill in your values:
   ```bash
   cp .env.template .env
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the bot:
   ```bash
   npm start
   ```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_TOKEN` | Telegram Bot API token from @BotFather | Yes |
| `MONGO_URI` | MongoDB connection string | Yes |
| `ADMIN_CHAT_IDS` | Comma-separated list of admin chat IDs | No |
| `DEX_CYCLE_INTERVAL_MS` | Price check interval in milliseconds | No (default: 20000) |
| `DEX_BATCH_SIZE` | Number of tokens per batch request | No (default: 30) |
| `DEX_BATCH_DELAY_MS` | Delay between batch requests in milliseconds | No (default: 1000) |
| `TG_QUEUE_DELAY_MS` | Delay between Telegram message sends in milliseconds | No (default: 35) |
| `WEBHOOK_URL` | Full webhook URL for Telegram (e.g., https://bot.example.com/webhook) | No |
| `WEBHOOK_PORT` | Webhook server port | No (default: 3000) |
| `WEBHOOK_PATH` | Webhook server path | No (default: /webhook) |
| `WEBHOOK_SECRET` | Secret token for webhook verification | Yes (if using webhook) |
| `BLOCKED_USERS_CACHE_TTL_MS` | Cache TTL for blocked users in milliseconds | No (default: 300000) |

## Testing

Run unit tests:
```bash
npm test
```

## Architecture

### Project Structure
```
DEX_alert_bot/
├── checkers/
│   └── dexPriceChecker.js    # Price checking logic
├── handlers/
│   ├── commands.js           # Main command handler
│   ├── alertCommands.js      # Alert CRUD operations
│   ├── tokenCommands.js      # Token info fetching
│   ├── adminCommands.js      # Admin commands
│   ├── utilityCommands.js    # Utility commands
│   └── sessionCommands.js    # Session management
├── lib/
│   ├── db.js                 # MongoDB connection
│   ├── telegram.js           # Telegram utilities
│   ├── telegramQueue.js      # Message queue with rate limiting
│   ├── users.js              # User management
│   └── fetchWithRetry.js     # HTTP fetch with retry logic
├── test/
│   ├── config.test.js
│   ├── conditionEvaluator.test.js
│   ├── fetchWithRetry.test.js
│   ├── formatPrice.test.js
│   ├── isValidTokenAddress.test.js
│   ├── telegramQueue.test.js
│   └── users.test.js
├── config.js                 # Configuration management
├── conditionEvaluator.js     # Alert condition evaluation
├── index.js                  # Main entry point
├── scheduler.js              # Task scheduler
└── webhookServer.js          # Webhook HTTP server
```

### Key Components

1. **DexPriceChecker**: Fetches token prices from DexScreener API and evaluates alert conditions
2. **TelegramQueue**: Manages outgoing message queue with rate limiting (~28 messages/second)
3. **SessionManager**: Handles multi-step command flows (add, remove, change tokens)
4. **ConditionEvaluator**: Evaluates whether price changes trigger alerts

## Security

- Input validation for all user inputs
- HTML escaping for user-generated content
- Rate limiting to prevent abuse
- Webhook secret verification
- MongoDB connection pooling with limits

## License

MIT
