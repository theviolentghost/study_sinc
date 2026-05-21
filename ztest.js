import * as cheerio from 'cheerio';

class Point {
    constructor(x, y, character) {
        this.x = x;
        this.y = y;
        this.character = character;
    }
}

async function display_secret_message(url) {
    try {
        const response = await fetch(url);
        const body = await response.text();
        const $ = cheerio.load(body);

        const table_rows = $('table tr');
        const points = [];
        // used for terminal rendering
        let max_x = 0;
        let max_y = 0;

        for(const row of table_rows) {
            const cells = $(row).find('td');
            const rowData = cells.map((index, cell) => { 
                return $(cell).text(); 
            })
            .get();
            // rowData[0] = x, rowData[1] = character, rowData[2] = y
            let x = parseInt(rowData[0]);
            let y = parseInt(rowData[2]);
            let character = rowData[1];
            if(isNaN(x) || isNaN(y)) continue; // skip invalid points, most likely title row containg labels

            points.push(new Point(x, y, character));

            // update max coordinates
            max_x = Math.max(max_x, x);
            max_y = Math.max(max_y, y);
        }

        print_to_terminal(points, max_x, max_y);
    } catch (error) {
        console.error('unable to decode message:', error);
    }
}

function print_to_terminal(points, max_x, max_y) {
    // makes 2d array of what should be displayed in the terminal
    // blank space is default
    const terminal_map = Array.from({ length: max_y + 1 }, () => { 
        return Array(max_x + 1).fill(' ')
    });

    for (const point of points) {
        // flip y to account for terminal rendering, 0 -> y
        terminal_map[max_y - point.y][point.x] = point.character;
    }

    for (const row of terminal_map) {
        // join, to create one string so it renders inline
        console.log(row.join(''));
    }
}

display_secret_message('https://docs.google.com/document/d/e/2PACX-1vSvM5gDlNvt7npYHhp_XfsJvuntUhq184By5xO_pA4b_gCWeXb6dM6ZxwN8rE6S4ghUsCj2VKR21oEP/pub');