import os
import json
import requests
from bs4 import BeautifulSoup
import re
import time

# Configuration
URL = "https://abc.com/shows/the-bachelorette/cast"
OUTPUT_DIR = "contestants"
DATA_FILE = "contestants.json"

def clean_text(text):
    return re.sub(r'\s+', ' ', text).strip()

def download_image(url, filename):
    try:
        response = requests.get(url, stream=True, timeout=10)
        if response.status_code == 200:
            with open(filename, 'wb') as f:
                for chunk in response.iter_content(1024):
                    f.write(chunk)
            return True
    except Exception as e:
        print(f"Error downloading {url}: {e}")
    return False

def scrape_contestants():
    # Ensure output directory exists
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    contestants = []
    
    print(f"Fetching {URL}...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        response = requests.get(URL, headers=headers, timeout=30)
        response.raise_for_status()
        html_content = response.text
        
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Look for cast links
        # Based on previous web_fetch, links look like <a href="/cast/...">
        links = soup.find_all('a', href=re.compile(r'/cast/'))
        print(f"Found {len(links)} potential cast members.")
        
        seen_names = set()

        for i, link in enumerate(links):
            href = link.get('href')
            full_url = f"https://abc.com{href}" if href.startswith('/') else href
            
            # Extract name and details
            text_content = link.get_text(separator='\n').strip()
            lines = [line.strip() for line in text_content.split('\n') if line.strip()]
            
            if not lines:
                continue
                
            name = lines[0]
            
            # Skip duplicates
            if name in seen_names:
                continue
            seen_names.add(name)
            
            # Skip Host and Bachelorette if detected
            if "Host" in name or "Jesse Palmer" in name or "Bachelorette" in name or "Taylor Frankie Paul" in name:
                print(f"Skipping non-contestant: {name}")
                continue
            
            # Extract details
            details = lines[1:] if len(lines) > 1 else []
            
            # Find image
            img_tag = link.find('img')
            img_src = img_tag.get('src') if img_tag else None
            
            # Prepare contestant object
            contestant = {
                "id": href.split('/')[-1] if href else f"unknown_{i}",
                "name": name,
                "details": details,
                "image_url": img_src,
                "profile_url": full_url
            }
            
            print(f"Found contestant: {name}")
            
            # Download image
            if img_src:
                # Handle query parameters in image URL
                clean_img_src = img_src.split('?')[0]
                ext = clean_img_src.split('.')[-1]
                if len(ext) > 4 or not ext: ext = "jpg"
                
                safe_name = re.sub(r'[^a-zA-Z0-9]', '_', name)
                image_filename = os.path.join(OUTPUT_DIR, f"{safe_name}.{ext}")
                
                if download_image(img_src, image_filename):
                    contestant['local_image_path'] = image_filename
                    print(f"  Downloaded image for {name}")
                else:
                    print(f"  Failed to download image for {name}")
            else:
                print(f"  No image found for {name}")
            
            contestants.append(contestant)
            
    except Exception as e:
        print(f"An error occurred during scraping: {e}")

    # Save to JSON
    with open(DATA_FILE, 'w') as f:
        json.dump(contestants, f, indent=2)
    
    print(f"\nScraping complete! Found {len(contestants)} contestants.")
    print(f"Data saved to {DATA_FILE}")
    print(f"Images saved to {OUTPUT_DIR}/")

if __name__ == "__main__":
    scrape_contestants()
