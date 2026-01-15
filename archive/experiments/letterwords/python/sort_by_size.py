dictionary = list()

def get_dictionary():
        file = open("dictionary.csv")
        for line in file:
                dictionary.append(line.strip())

def set_dictionary():
	file = open("newdictionary.csv",'w')
	for word in dictionary:
		file.write(word + '\n')

get_dictionary()
dictionary.sort()
dictionary.sort(key=len)
set_dictionary()
print('DONE')
