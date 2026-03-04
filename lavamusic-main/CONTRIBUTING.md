# 🤝 Contributing to Lavamusic

## 🤓 For the Tech-Savvy Coders

- ⌨️ **Crafted in TypeScript** for reliability
- ⚡ **Powered by Discord.js** and Lavalink-Client
- 🗃️ **Data with Drizzle ORM**: SQLite by default, PG/MySQL ready
- 📂 **Open Source** under GPL-3.0

## 🏗️ Build and Tweak

Developer mode? Let's code:  
- Ensure you have [Bun](https://bun.sh) installed.

1. **Install dependencies**:
    ```bash
    bun install
    ```
2. **Environment setup**:  
   ```bash
   cp .env.example .env
   ```
   - Fill in your credentials.
3. **Database migration**:
    ```bash
    bun run db:push
    ```
4. **Run in development mode** (Hot-reload):
    ```bash
    bun run dev
    ```
5. **Compile everything**:
    ```bash
    bun run build
    ```
6. **Run the build**:
    ```bash
    bun run start
    ```
7. **Lint & Format**: Ensure code quality before committing.
    ```bash
    bun run format
    bun run lint
    ```

## 🤝 How to Contribute

1. Fork this repo
2. Create a branch for your amazing idea
3. Code, test, and shine
4. Send a pull request—we'll review it fast!

## 🩹 Common Quick Fixes
  - **"Bot not responding?"** Check your token and Lavalink is running.
  - **Audio issues?** Verify Lavalink config and plugins.
  - **Permissions problem?** Ensure bot has proper server roles.