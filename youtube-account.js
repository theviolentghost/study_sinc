
import { Innertube } from 'youtubei.js';
import puppeteer from 'puppeteer';

let singedInInstances = {};
let guestInstance = await Innertube.create();;

function getAccountInstance(id){
    let instance = singedInInstances[id];
    return instance ? instance.instance : guestInstance;
}

function isLoggedIn(id){
    return singedInInstances[id] ? true : false;
}

async function createdSingedInInstance(cookieString, id){
    const yt = await Innertube.create({
        cache: new Map(),
        cookie: cookieString,
        generate_sapisidhash: true
    });
    singedInInstances[id] = { instance: yt, loggedIn: true };
}

function getCookieString(cookies){
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

async function awaitLogin(page, id){
    console.log('waiting');
    
    try{
        await page.waitForSelector('button#avatar-btn', { timeout: 300000 });
    } catch(err){
        console.log('timeout');
        return;
    }
    const cookies = await page.cookies('https://www.youtube.com');
    const cookieString = getCookieString(cookies);
    createdSingedInInstance(cookieString, id);
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
    const client = await page.target().createCDPSession();
    await client.send('WebAuthn.enable');
    await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
        protocol: 'ctap2', 
        transport: 'usb',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true
    }
    });
    await page.setDefaultNavigationTimeout(60000);
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.goto('https://www.youtube.com', { waitUntil: 'networkidle2' });
    await login_click(page, .95, 0.05);
    return {page: page, browser: browser};
}

async function login_click(page, xPercentage, yPercentage){
    if(!page) return;
    const dimensions = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio
    }));

    console.log('clcking');
    await page.mouse.click(dimensions.width * xPercentage, dimensions.height * yPercentage);
}

async function login_type(page, input){
    if(!page) return;
    console.log(input);
    if(!input) {
        page.keyboard.type(' ');
        return;
    }
    await await page.keyboard.press(input);
}

export default{
    isLoggedIn: isLoggedIn,
    getAccountInstance: getAccountInstance,
    login_type: login_type,
    login_click: login_click,
    awaitLogin: awaitLogin,
    initializeLogin: initializeLogin,
};

