import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// Helper for colored console output
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
};

const log = (message, color = colors.reset) => console.log(`${color}%s${colors.reset}`, message);

/**
 * Formats bytes into a human-readable string (KB, MB, GB, etc.).
 * @param {number} bytes - The number of bytes.
 * @param {number} [decimals=2] - The number of decimal places.
 * @returns {string}
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Converts a .app bundle into a .ipa archive.
 * @param {string} appPath - The path to the .app bundle.
 */
function createAppToIpa(appPath) {
    if (!appPath || !appPath.endsWith('.app')) {
        log("Usage: node app.to.ipa.js /path/to/YourApp.name.app", colors.red);
        process.exit(1);
    }

    if (!fs.existsSync(appPath)) {
        log(`Error: App path not found at "${appPath}"`, colors.red);
        process.exit(1);
    }

    const appName = path.basename(appPath, ".app");
    const workDir = path.join(process.cwd(), "ipa_build_temp");
    const payloadDir = path.join(workDir, "Payload");
    const finalIpaPath = path.join(process.cwd(), `${appName}.ipa`);

    try {
        log(`Starting conversion for "${appName}.app"...`);

        // 1. Clean up and create working directory
        log("  - Cleaning up previous build directories...");
        fs.rmSync(workDir, { recursive: true, force: true });
        fs.mkdirSync(payloadDir, { recursive: true });

        // 2. Copy .app bundle to Payload directory
        log(`  - Copying "${appName}.app" to Payload...`);
        execSync(`cp -R "${appPath}" "${payloadDir}/"`);

        // 3. Create the .ipa file by zipping the Payload
        log("  - Creating .ipa archive...");
        const ipaName = `${appName}.ipa`;
        execSync(`cd "${workDir}" && zip -r "${ipaName}" "Payload"`);

        // 4. Move the .ipa to the final destination
        const tempIpaPath = path.join(workDir, ipaName);
        log(`  - Moving .ipa to "${finalIpaPath}"...`);
        fs.renameSync(tempIpaPath, finalIpaPath);

        // Get and log the file size
        const stats = fs.statSync(finalIpaPath);
        log(`  - Final size: ${formatBytes(stats.size)}`);

        log(`\nSuccessfully created "${appName}.ipa"`, colors.green);

    } catch (error) {
        log(`\nError during conversion: ${error.message}`, colors.red);
        process.exit(1);
    } finally {
        // 5. Final cleanup
        log("  - Cleaning up temporary files...");
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

/**
/Users/norbertzych/Library/Developer/Xcode/DerivedData/MusiK-fgictlqklccskbddurmwysxjbwau/Build/Products/Debug-iphoneos/MusiK.app
 */

// --- Main Execution ---
const appPathArg = process.argv[2];
createAppToIpa(appPathArg);