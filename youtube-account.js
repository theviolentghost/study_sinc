import { Innertube } from 'youtubei.js';
import puppeteer from 'puppeteer';

async function awaitLogin(page){
    console.log('waiting');
    
    await page.waitForSelector('button#avatar-btn', { timeout: 120000 });
    const cookies = await page.cookies('https://www.youtube.com');
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const yt = await Innertube.create({
        cache: new Map(),
        cookie: cookieString,
        generate_sapisidhash: true
    });

    let results = await yt.getHomeFeed();
    return results;
}

async function initializeLogin(){
    console.log('starting login');
    const browser = await puppeteer.launch({
        headless: false,
        args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        ],
        defaultViewport: null,
    });
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.goto('https://www.youtube.com', { waitUntil: 'networkidle2' });
    return {page: page, browser: browser};
}

export default{
    awaitLogin: awaitLogin,
    initializeLogin: initializeLogin,
};

