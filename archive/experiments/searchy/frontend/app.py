from flask import Flask, render_template, request
from pymongo import MongoClient
import time

app = Flask(__name__)

def compare_lists(a,b):
    i = 0
    for item in a:
        if item in b:
            i+=1
    return i

def mongo_db_search(query):
    client = MongoClient()
    db = client["database"]
    collection = db["collection"]
    collection.create_index([("data", "text")])
    results = list(
        collection.find(
            {"$text": {"$search": query}}, {"score": {"$meta": "textScore"}}
        )
        .sort([("score", {"$meta": "textScore"})])
        .limit(10)
    )
    resultLinks = [
        d["name"]
        .replace("../crawler/data/", "")
        .replace("|", "/")
        .replace(".txt", "")
        for d in results
    ]
    return resultLinks

@app.route("/")
def hello():
    start = time.clock()
    query = request.args.get("query")
    resultLinks = list()
    if query:
        print("query: " + query)
        resultLinks = mongo_db_search(query)
        print(resultLinks)
    end = time.clock()
    print(end - start)
    return render_template("index.html", results = resultLinks)

@app.route("/test")
def test():
    queries = {"world cup":{"https://www.fifa.com/worldcup/qatar2022/","https://www.fifa.com/","https://en.wikipedia.org/wiki/FIFA_World_Cup","https://en.wikipedia.org/wiki/World_Cup","https://www.rugbyworldcup.com/?lang=en","https://twitter.com/FIFAWorldCup?ref_src=twsrc%5Egoogle%7Ctwcamp%5Eserp%7Ctwgr%5Eauthor","https://www.britannica.com/sports/World-Cup-football", "https://www.cricketworldcup.com/",  "https://timesofindia.indiatimes.com/sports/cricket/icc-cricket-world-cup-2019", "https://www.cbssports.com/soccer/world-cup/"}
            ,"hurricane florence":{"https://en.wikipedia.org/wiki/Hurricane_Florence","https://www.weather.gov/mhx/Florence2018","https://www.nhc.noaa.gov/data/tcr/AL062018_Florence.pdf","https://www.worldvision.org/disaster-relief-news-stories/2018-hurricane-florence-facts", "https://www.accuweather.com/en/weather-news/dangerous-category-4-hurricane-florence-likely-to-stall-and-pound-carolinas-virginia-for-days/70006011", "https://www.cbsnews.com/live-news/hurricane-florence-aftermath-weather-flooding-power-outage-death-toll-fema-latest-forecast-live/", "https://www.latimes.com/nation/la-na-hurricane-florence-live-updates-htmlstory.html", "https://www.cnn.com/2018/09/17/us/florence-hurricane-tropical-storm/index.html","https://www.cnn.com/2018/09/12/us/hurricane-florence-south-east-coast-wxc/index.html", "https://www.theatlantic.com/photo/2018/09/photos-the-aftermath-of-hurricane-florence/570397/"}
            ,"mac miller":{"https://en.wikipedia.org/wiki/Mac_Miller","https://origin.macmillerswebsite.com/","https://www.youtube.com/channel/UC3SEvBYhullC-aaEmbEQflg","https://pitchfork.com/artists/30111-mac-miller/","https://www.rollingstone.com/music/music-news/mac-miller-dead-at-26-720756/","https://www.rollingstone.com/music/music-features/mac-miller-legacy-loss-756802/","https://soundcloud.com/larryfisherman","https://twitter.com/macmiller?lang=en","https://www.tmz.com/2019/11/29/goldlink-addresses-mac-miller-comments-anderson-paak-divine-feminine/","https://www.facebook.com/macmillerfans/"
                }
            ,"kate spade":{"https://www.katespade.com/","https://www.nytimes.com/2018/06/05/fashion/kate-spade-dead.html","https://en.wikipedia.org/wiki/Kate_Spade","https://www.shopbop.com/kate-spade-new-york/br/v=1/5143.htm?all","https://shop.nordstrom.com/brands/kate-spade-new-york--999","https://www.facebook.com/katespadeny/","https://www.6pm.com/b/kate-spade-new-york/brand/1038","https://twitter.com/katespadeny?lang=en https://katespadeny.tumblr.com/","https://www.instagram.com/katespadeny/?hl=en"}
            ,"anthony bourdain":{"https://en.wikipedia.org/wiki/Anthony_Bourdain","https://www.cnn.com/2018/06/08/us/anthony-bourdain-obit/index.html","https://www.biography.com/personality/anthony-bourdain","http://www.anthonybourdain.net/","https://www.travelchannel.com/shows/anthony-bourdain","https://explorepartsunknown.com/","https://www.nytimes.com/2018/06/08/business/media/anthony-bourdain-dead.html","https://www.facebook.com/AnthonyBourdain/","https://www.ciachef.edu/anthony-bourdain/","https://twitter.com/bourdain?lang=en"
                }
            ,"black panther":{"https://en.wikipedia.org/wiki/Black_Panther_(film)","https://www.imdb.com/title/tt1825683/","https://movies.disney.com/black-panther","https://time.com/black-panther/","https://www.marvel.com/movies/black-panther","https://www.rottentomatoes.com/m/black_panther_2018","https://www.facebook.com/BlackPantherMovie/","https://www.nytimes.com/2018/02/06/movies/black-panther-review-movie.html","https://marvelcinematicuniverse.fandom.com/wiki/Black_Panther_(film)","https://www.britannica.com/topic/Black-Panther-comic-book-character"}
            ,"mega million results":{"https://www.megamillions.com/Winning-Numbers.aspx","https://www.megamillions.com/Winning-Numbers/Previous-Drawings.aspx","https://www.megamillions.com/","https://www.mlive.com/lottery/2019/11/mega-millions-results-for-112919-did-anyone-win-the-243m-jackpot.html","https://www.usamega.com/mega-millions-history.asp","https://www.newsweek.com/mega-millions-results-winners-winning-numbers-lottery-11-26-19-1474317","https://www.newsweek.com/lottery-mega-millions-11-08-2019-winner-1470772","https://www.nj.com/lottery/2019/11/mega-millions-lottery-did-you-win-fridays-243m-mega-millions-drawing-live-results-winning-numbers-11292019.html","https://www.nj.com/lottery/2019/11/mega-millions-lottery-did-you-win-tuesdays-226m-mega-millions-drawing-live-results-winning-numbers-11262019.html","https://nclottery.com/MegaMillions"}
            , "stan lee":{"https://en.wikipedia.org/wiki/Stan_Lee","https://twitter.com/TheRealStanLee?ref_src=twsrc%5Egoogle%7Ctwcamp%5Eserp%7Ctwgr%5Eauthor","https://www.imdb.com/name/nm0498278/","https://www.marvel.com/comics/discover/546/stan-lee https://therealstanlee.com/","https://www.hollywoodreporter.com/heat-vision/stan-lee-dead-marvel-comics-real-life-superhero-was-95-721450","https://www.britannica.com/biography/Stan-Lee","https://www.nytimes.com/2018/11/12/obituaries/stan-lee-dead.html","https://www.facebook.com/realstanlee/","https://www.mentalfloss.com/article/71299/10-amazing-fantastic-incredible-facts-about-comic-book-writer-stan-lee"}
            , "demi lovato":{"http://www.demilovato.com/","https://en.wikipedia.org/wiki/Demi_Lovato","https://www.instagram.com/ddlovato/?hl=en","https://www.youtube.com/channel/UCZkURf9tDolFOeuw_4RD7XQ","https://www.independent.co.uk/topic/demi-lovato","https://people.com/music/demi-lovato-been-through-a-lot-first-interview/","https://www.facebook.com/DemiLovato/","https://www.hollywoodreporter.com/news/demi-lovato-reflects-year-hospitalization-i-am-human-be-easy-me-1251892","http://www.mtv.com/artists/demi-lovato","https://www.mirror.co.uk/all-about/demi-lovato"}
            ,"kavanaugh confirmation":{"https://en.wikipedia.org/wiki/Brett_Kavanaugh_Supreme_Court_nomination","https://www.nytimes.com/2018/10/06/us/politics/brett-kavanaugh-supreme-court.html","https://www.cnn.com/interactive/2018/10/politics/timeline-kavanaugh/","https://www.nationalreview.com/2019/10/brett-kavanaugh-confirmation-what-weve-learned-one-year-later/","https://www.theguardian.com/us-news/2018/oct/06/brett-kavanaugh-confirmed-us-supreme-court","https://www.politico.com/tag/kavanaugh-confirmation","https://www.politico.com/interactives/2018/brett-kavanaugh-senate-confirmation-vote-count/","https://ballotpedia.org/Brett_Kavanaugh_confirmation_hearings","https://time.com/5401624/brett-kavanaugh-confirmation/","https://civilrights.org/resource/oppose-the-confirmation-of-brett-kavanaugh-to-the-supreme-court-of-the-united-states/"}
        }
    for query,results in queries.items():
        print(query)
        links = mongo_db_search(query)
        count = compare_lists(links,results)
        print(count)
    return "Done"

if __name__ == "__main__":
    app.run()
