# Bachelorette Bracket Scraper

This tool helps you generate a March Madness style bracket for the upcoming season of *The Bachelorette*.

It scrapes contestant data (names, bios, photos) from the official ABC website and saves it locally.

## Setup

1.  **Install Dependencies**:
    You need Python 3.8+ installed.
    
    ```bash
    pip install -r requirements.txt
    ```

2.  **Run the Scraper**:
    
    ```bash
    python scrape_contestants.py
    ```
    
    This will:
    - Fetch the cast page.
    - Extract contestant information.
    - Download their photos to the `contestants/` folder.
    - Save all data to `contestants.json`.

## Usage

Once you have the data in `contestants.json` and images in `contestants/`, you can use it to:
- Print out cards for a physical bracket.
- Build a simple web page for voting.
- Or just browse through the candidates!

## Note

This script is configured for the current Bachelorette URL: `https://abc.com/shows/the-bachelorette/cast`.
If the URL changes, update the `URL` variable in `scrape_contestants.py`.
