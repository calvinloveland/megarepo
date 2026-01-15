while True:
    string = input()
    strings = string.split()
    for token in strings:
        print("%token K" + token.upper())
