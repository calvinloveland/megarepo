import gtts
import pathlib

def generate_mp3_from_string(string, filename="output.mp3"):
    obj = gtts.gTTS(text=string, lang="en", slow=False)
    obj.save(filename)
    return pathlib.Path(filename) 