import sys
import os
from pymongo import MongoClient
from backend.shared import utils

ingestDir = sys.argv[1]
priorityLinks = list(utils.parseLinkFile(sys.argv[2]).queue)
print("Ingesting at: " + ingestDir)
files = [
    os.path.join(ingestDir, f)
    for f in os.listdir(ingestDir)
    if os.path.isfile(os.path.join(ingestDir, f))
]

for l in priorityLinks:
    files.insert(0,os.path.join(ingestDir, l))

fileCount = len(files)

print("Found " + str(fileCount) + " files")
print("Starting at: " + files[0])

client = MongoClient()
db = client["database"]
collection = db["collection"]

i = 0
good = 0
bad = 0
for f in files:
    try:
        i += 1
        if i % 1000 == 0:
            print(str(i) + "/" + str(fileCount) + " " + f)
        with utils.timeout(seconds=60):
            if f.endswith(".link"):
                links = list(utils.parseLinkFile(f).queue)
                collection.update_one(
                    {"name": f}, {"$set": {"links": links}}, upsert=True
                )
                good += 1
            elif f.endswith(".txt"):
                data = ""
                with open(f, "r") as dataFile:
                    data = dataFile.read()
                collection.update_one(
                    {"name": f}, {"$set": {"data": data}}, upsert=True
                )
                good += 1
            else:
                print("Unkown file type: " + f)
                bad += 1
    except Exception as e:
        bad += 1
        print(e)
        print(f)
print("Good: " + str(good))
print("Bad: " + str(bad))
