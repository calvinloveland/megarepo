import signal
import sys
import math
import queue
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from urllib import robotparser
import time
from backend.shared import utils

robotsDict = {}


def baseUrl(url):
    parsed_uri = urlparse(url)
    return "{uri.scheme}://{uri.netloc}".format(uri=parsed_uri)


def robotsAllowed(url):
    robotUrl = baseUrl(url) + "/robots.txt"
    if robotUrl in robotsDict:
        return robotsDict[robotUrl].can_fetch("*", url)
    else:
        rp = robotparser.RobotFileParser()
        rp.set_url(robotUrl)
        rp.read()
        robotsDict[robotUrl] = rp
        return rp.can_fetch("*", url)


def parsePage(pageURL):
    response = requests.get(pageURL, timeout=(10, 10), stream=False)
    if response.status_code != 200:
        print("bad return code!! " + str(response.status_code))
    soup = BeautifulSoup(response.text, "html.parser")
    links = list()
    for link in soup.find_all("a", href=True):
        reference = link.get("href")
        if (
            "javascript:" not in reference
            and len(reference) > 0
            and reference[0] != "#"
        ):
            if len(reference) > 0 and (reference[0] == "/" or reference[0] == "."):
                reference = baseUrl(pageURL) + reference
            links.append(reference)
    text = soup.get_text()
    return links, text


def crawlWeb(toDoFile, doneFile):
    toCrawl = utils.parseLinkFile(toDoFile)
    doneLinks = list(utils.parseLinkFile(doneFile).queue)
    print("Parsed links: " + str(len(doneLinks)))
    lastParsed = time.time()
    lastUrl = ""
    url = ""
    try:
        while True:
            try:
                with utils.timeout(seconds=20):
                    url = toCrawl.get()
                    if not robotsAllowed(url):
                        print("Not allowed at: " + url)
                    elif url in doneLinks:
                        print("Already parsed: " + url)
                    else:
                        while time.time() - lastParsed < 0.25:
                            if baseUrl(url) == lastUrl:
                                toCrawl.put(url)
                                print("Skipping for now: " + url)
                                url = toCrawl.get()
                            else:
                                time.sleep(0.01)
                        print(str(toCrawl.qsize()) + "-Parsing:" + url)
                        pageLinks, pageText = parsePage(url)
                        lastParsed = time.time()
                        lastUrl = baseUrl(url)
                        linkFile = open("data/" + url.replace("/", "|") + ".link", "w+")
                        textFile = open("data/" + url.replace("/", "|") + ".txt", "w+")
                        for link in pageLinks:
                            if link not in doneLinks and toCrawl.qsize() < 10000:
                                toCrawl.put(link)
                            linkFile.write(link + "\n")
                        linkFile.close()
                        textFile.write(pageText)
                        textFile.close()
                    with open(doneFile, "a") as df:
                        df.write(url + "\n")
                        doneLinks.append(url)
            except Exception as e:
                print(e)
                print(url)
    except KeyboardInterrupt:
        print("さようなら")
        with open(toDoFile, "w") as tdf:
            tdf.write(url + "\n")
            for i in range(math.floor(toCrawl.qsize() / 10)):
                tdf.write(toCrawl.get() + "\n")


crawlWeb("ToDo.link", "Done.link")
