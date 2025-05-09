import express from 'express';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';

const timeout = parseInt(process.env.TIMEOUT) || 3000;
const PORT = process.env.PORT || 3000;

dotenv.config();

const app = express();

app.use(express.json());

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const fetchTasks = async (username, password) => {
    const browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: null,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = (await browser.pages())[0];

        page.setRequestInterception(true)

        page.on('request', async request => {
            if (['image', 'fetch', 'media', 'font', 'stylesheet'].includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        })

        console.log('Navigating to login page...');
        await page.goto('https://ebelajar.stiki.ac.id/login', {
            waitUntil: ['domcontentloaded', 'networkidle2'],
            timeout: 60000,
        });

        await page.type('input[name="username"]', username);
        await page.type('input[name="password"]', password);
        await sleep(timeout);
        await page.click('#loginbtn');

        await page.waitForFunction(
            'window.location.href === "https://ebelajar.stiki.ac.id/my/"',
            { timeout: 60000 }
        );

        if (page.url() !== 'https://ebelajar.stiki.ac.id/my/') {
            throw new Error('Login failed!');
        }

        try {
            await page.waitForSelector('#action-menu-toggle-0 > span > span.usertext', { timeout: 15000 });
        } catch (error) {
            console.error('Error waiting for user text:', error.message);
            throw new Error('Login failed! ');
        }

        console.log('Login successful!');
        const user = await page.$eval(
            '#action-menu-toggle-0 > span > span.usertext',
            (el) => el.innerText.trim().split('id ')[1]
        );

        console.log(`Logged in as: ${user}`)
        console.log('Fetching tasks...');

        await sleep(timeout);

        await page.waitForSelector('[data-region="event-list-content"]', { timeout: 60000 });

        const isViewMore = await page.$('button[data-action="view-more"]');
        if (isViewMore) {
            await isViewMore.click();
            await page.waitForFunction(() => {
                const btn = document.querySelector('button[data-action="view-more"]');
                return btn && btn.disabled;
            }, { timeout: 60000 });
        }

        await sleep(timeout);

        const tasks = await page.evaluate(() => {
            const dateOffsets = [-14, 1, 7, 30];
            const taskData = [];

            dateOffsets.forEach((offset) => {
                const container = document.querySelector(
                    `[data-region="event-list-content"]:not(.hidden) > [data-start-day="${offset}"]`
                );
                if (!container) return;

                const headingDate = container.querySelector('h5')?.textContent.trim() || '';
                const tasks = container.querySelectorAll('ul li');

                tasks.forEach((task) => {
                    const nameElement = task.querySelector('.event-name');
                    const dateElement = task.querySelector('.span5');
                    const course = nameElement?.parentElement.querySelector('div')?.textContent.trim().replace(/\s+/g, ' ') || '';

                    if (!nameElement || !dateElement || nameElement.textContent.includes('Feedback')) return;

                    taskData.push({
                        headingDate,
                        name: nameElement.textContent.trim(),
                        url: nameElement.href.trim(),
                        course,
                        date: dateElement.textContent.trim(),
                    });
                });
            });

            return taskData.reduce((grouped, task) => {
                grouped[task.headingDate] = grouped[task.headingDate] || [];
                grouped[task.headingDate].push({
                    name: task.name,
                    url: task.url,
                    course: task.course,
                    date: task.date,
                });
                return grouped;
            }, {});
        });

        console.log('Tasks fetched successfully!');

        return { user, tasks };
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }
};

app.post('/get-tugas', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required!' });
    }

    try {
        const { user, tasks } = await fetchTasks(username, password);
        res.status(200).json({
            username: user,
            message: 'Login successful!',
            tasks,
        });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
});
