# Security Policy for DEX Alert Bot

## Supported Versions

| Version | Status | Supported Until |
|---------|--------|-----------------|
| 2.0.0   | Current | TBD |

## Reporting a Vulnerability

Please report security vulnerabilities privately to the administrator. Do not create public issues.

## Security Features

1. **Input Validation** - All user inputs are validated before database operations
2. **XSS Protection** - HTML escaping for all user-generated content
3. **Rate Limiting** - Command rate limiting to prevent abuse
4. **Environment Variables** - Sensitive data (TELEGRAM_TOKEN, MONGO_URI) stored in .env
5. **Broadcast Limits** - Admin broadcast limited to prevent DOS
6. **Connection Pooling** - MongoDB connection limits configured

## Environment Variables

- `TELEGRAM_TOKEN` - Required, Bot API token
- `MONGO_URI` - Required, MongoDB connection string
- `ADMIN_CHAT_IDS` - Comma-separated admin IDs
- `DEX_CYCLE_INTERVAL_MS` - Check interval (ms)
- `DEX_BATCH_SIZE` - Batch size for DexScreener API

## Security Recommendations

1. Use a dedicated MongoDB user with limited permissions
2. Store TELEGRAM_TOKEN in a secure secret manager
3. Enable MongoDB authentication
4. Use SSL/TLS for MongoDB connection (mongodb+srv://)
5. Regularly update dependencies
6. Set proper file permissions (600 for .env)
