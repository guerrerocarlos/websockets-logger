# Agent Workflow Documentation

This document outlines automated workflows and procedures for maintaining the websockets-logger package.

## NPM Publishing Workflow

### Overview
The package uses GitHub Actions to automatically publish to npm when changes are pushed to the `main` branch.

### Publishing Process

1. **Update the Code**
   - Make necessary code changes
   - Build and test the changes locally:
     ```bash
     npm install
     npm run build
     npm run lint
     ```

2. **Bump the Version**
   - Update the version in `package.json` following semantic versioning:
     - **Patch** (0.1.1 → 0.1.2): Bug fixes, minor changes
     - **Minor** (0.1.1 → 0.2.0): New features, backward compatible
     - **Major** (0.1.1 → 1.0.0): Breaking changes

   Example:
   ```json
   {
     "name": "websockets-logger",
     "version": "0.1.2",
     ...
   }
   ```

3. **Commit and Push Changes**
   - Stage all changes including the updated version
   - Create a descriptive commit message
   - Push to the `main` branch

   ```bash
   git add .
   git commit -m "Add X-API-Key header support

   🤖 Generated with Claude Code

   Co-Authored-By: Claude <noreply@anthropic.com>"
   git push origin main
   ```

4. **Automatic Publishing**
   - GitHub Actions workflow (`.github/workflows/publish.yml`) triggers on push
   - The workflow:
     - Checks out the code
     - Installs dependencies with pnpm
     - Runs linting (`pnpm lint`)
     - Builds the package (`pnpm build`)
     - Checks if the version already exists on npm
     - Publishes to npm if it's a new version (using `NPM_TOKEN` secret)
     - Skips publishing if the version already exists

5. **Verify Publication**
   - Check the GitHub Actions tab for workflow status
   - Verify the package on npm: https://www.npmjs.com/package/websockets-logger
   - Test installation: `npm install websockets-logger@latest`

### Important Notes

- **Version must be bumped** before pushing, or the workflow will skip publishing
- The workflow uses `--no-git-checks` to allow publishing without git tags
- Publishing uses the `NPM_TOKEN` secret configured in GitHub repository settings
- The workflow runs on every push to `main`, but only publishes when a new version is detected

### Example: Publishing a New Feature

```bash
# 1. Make code changes
# 2. Build and test
npm run build && npm run lint

# 3. Update version in package.json (e.g., 0.1.1 → 0.2.0)
# 4. Commit and push
git add .
git commit -m "Add new feature"
git push origin main

# 5. Monitor GitHub Actions for automatic publish
```

## API Key Header Implementation

### Context
The package now supports the X-API-Key header required by `https://websockets.omattic.com/hub`.

### Usage
Users can provide API keys in two ways:

1. **Using `apiKey` option (recommended):**
   ```javascript
   const logger = new WebSocketLogger({
     wsUrl: 'wss://websockets.omattic.com/hub',
     apiKey: 'your-api-key-here'
   });
   ```

2. **Using `headers` option:**
   ```javascript
   const logger = new WebSocketLogger({
     wsUrl: 'wss://websockets.omattic.com/hub',
     headers: {
       'X-API-Key': 'your-api-key-here'
     }
   });
   ```

The `apiKey` option is automatically merged into headers as `X-API-Key`.
