words = input().split()

for word in words:
    print("(" + word.upper() + "|" + word.lower() + ") {std::cerr << \"Keyword: "+ word.upper() + "\\n\" ;return K" + word.upper() + ";}")
