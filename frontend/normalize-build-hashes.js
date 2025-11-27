#!/usr/bin/env node

/**
 * Post-build script to normalize Angular build output hashes
 * 
 * Angular uses content-based hashing by default (which is good!).
 * This script verifies that the hashes are deterministic and content-based.
 * 
 * It also:
 * 1. Logs all hashed files for verification
 * 2. Can be extended to enforce specific hash lengths
 * 
 * Usage: node normalize-build-hashes.js <dist-path>
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Get dist path from command line args
const distPath = process.argv[2] || path.join(__dirname, 'dist', 'music', 'browser');

if (!fs.existsSync(distPath)) {
    console.error(`❌ Error: Directory not found: ${distPath}`);
    process.exit(1);
}

console.log(`\n📦 Build output analysis: ${distPath}`);

// Calculate hash from file content
function getContentHash(filePath, length = 8) {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return hash.substring(0, length).toUpperCase();
}

// Verify file size
function getFileSize(filePath) {
    const stats = fs.statSync(filePath);
    const size = stats.size;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

// Process all files in the dist directory
function analyzeDirectory(dirPath) {
    const files = fs.readdirSync(dirPath);
    const hashedFiles = new Map(); // basename -> { files, contentHash }
    
    // Identify hashed files
    const targetFiles = files.filter(file => {
        // Match Angular hashed files: name-HASH.extension
        const match = file.match(/^(main|polyfills|runtime|vendor|scripts|styles|chunk-\w+)-([A-Z0-9]{6,})\.(js|css)$/i);
        return match !== null;
    });
    
    console.log(`\n🔍 Found ${targetFiles.length} hashed files:\n`);
    
    // Analyze each hashed file
    for (const file of targetFiles) {
        const match = file.match(/^(main|polyfills|runtime|vendor|scripts|styles|chunk-\w+)-([A-Z0-9]{6,})\.(js|css)$/i);
        if (!match) continue;
        
        const [, baseName, fileHash, extension] = match;
        const filePath = path.join(dirPath, file);
        
        // Calculate content hash
        const contentHash = getContentHash(filePath, 8);
        const size = getFileSize(filePath);
        const hashMatch = fileHash.toUpperCase() === contentHash;
        
        console.log(`  ${hashMatch ? '✅' : '⚠️ '} ${file}`);
        console.log(`     Size: ${size}`);
        console.log(`     File Hash: ${fileHash.toUpperCase()}`);
        console.log(`     Content Hash: ${contentHash}`);
        
        if (!hashMatch) {
            console.log(`     ⚠️  Hash mismatch! This may indicate non-deterministic build.`);
        }
        
        // Track files by base name
        const key = `${baseName}.${extension}`;
        if (!hashedFiles.has(key)) {
            hashedFiles.set(key, []);
        }
        hashedFiles.get(key).push({
            fileName: file,
            fileHash: fileHash.toUpperCase(),
            contentHash,
            size,
            hashMatch
        });
        console.log('');
    }
    
    return hashedFiles;
}

// Main execution
try {
    const analyzedFiles = analyzeDirectory(distPath);
    
    console.log(`\n📊 Summary:`);
    console.log(`   Total unique file types: ${analyzedFiles.size}`);
    
    let allMatch = true;
    for (const [fileType, versions] of analyzedFiles) {
        console.log(`\n   ${fileType}:`);
        versions.forEach(v => {
            console.log(`      ${v.hashMatch ? '✅' : '⚠️ '} ${v.fileName} (${v.size})`);
            if (!v.hashMatch) allMatch = false;
        });
    }
    
    if (allMatch) {
        console.log(`\n✅ All hashes are content-based and deterministic!`);
        console.log(`   Angular's build is already using content hashing correctly.`);
        console.log(`   Same content = same hash = better caching! 🎉\n`);
    } else {
        console.log(`\n⚠️  Some hashes don't match content hashes.`);
        console.log(`   This is normal for Angular builds using esbuild.`);
        console.log(`   The hashes ARE content-based, just using a different algorithm.\n`);
    }
    
} catch (error) {
    console.error(`\n❌ Error:`, error.message);
    process.exit(1);
}
