
import { Innertube } from 'youtubei.js';
import puppeteer from 'puppeteer';

const youtubeLoginSessions = {};

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
    try{
        await page.waitForSelector('button#avatar-btn', { timeout: 300000 });
    } catch(err){
        console.log('login timeout id:' + id);
        endLoginSession(id);
        return;
    }
    const cookies = await page.cookies('https://www.youtube.com');
    const cookieString = getCookieString(cookies);
    createdSingedInInstance(cookieString, id);
}

async function initializeLogin(){
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

    try{
        await page.mouse.click(dimensions.width * xPercentage, dimensions.height * yPercentage);
    } catch(err){
        console.error("failed to login click");
        console.error(err);
    }
}

async function login_type(page, input){
    if(!page) return;
    if(!input) {
        page.keyboard.type(' ');
        return;
    }
    try{
        await await page.keyboard.press(input);
    } catch(err){
        console.error("failed to login type");
        console.error(err);
    }
}

async function endLoginSession(id){
    try{
        await youtubeLoginSessions[id].browser.close();
        delete youtubeLoginSessions[id];
        return "ended login session " + id;
    } catch (err){
        return "failed to end session";
    }
}

function getLoginSession(id){
    return youtubeLoginSessions[id];
}

function setLoginSession(id, browser, page){
    let object = { browser: browser, page: page, interval: null };
    if(!object) return;
    youtubeLoginSessions[id] = object;
}

export default{
    isLoggedIn: isLoggedIn,
    getAccountInstance: getAccountInstance,
    login_type: login_type,
    login_click: login_click,
    awaitLogin: awaitLogin,
    initializeLogin: initializeLogin,
    getLoginSession: getLoginSession,
    endLoginSession: endLoginSession,
    setLoginSession: setLoginSession,
};

