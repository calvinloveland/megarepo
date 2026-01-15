import random

dictionary = list()
phrases = list()
possibilities = list()

def get_random(count):
	rstring = ''
	for i in range(count):
		rstring = rstring + random.choice(phrases) + ' '
	return rstring

def set_dictionary():
	file = open("dictionary.csv")
	for line in file:
		dictionary.append(line.strip())

def count_characters(string):
	return len(string) - string.count(' ')

def find_phrases(tw,tl):
	for word in dictionary:
		if len(word) <= tl+1-tw:
			possibilities.append(word + ' ')
		else:
			break
	while len(possibilities) > 0:
		check = possibilities.pop()
		cc = count_characters(check)
		wc = check.count(' ')
		#print(check +'|'+ str(cc) +'|'+ str(wc))
		if cc == tl and wc == tw:
			phrases.append(check)
		elif cc+wc < tl+tw and wc < tw:
			for word in dictionary:
				if len(word) + cc < tl or (wc==tw-1 and len(word) + cc == tl):
					possibilities.append(check + word + ' ')
				else:
					break 

set_dictionary()

word_count = input('word count:')
letter_count = input('letter count:')
find_phrases(word_count,letter_count)
print(str(len(phrases))+'- Possibilitites for '+ str(word_count) + ' words and '+ str(letter_count) + ' letters | Some highlights: ')
print(get_random(1))
print(get_random(1))
print(get_random(1))
print(get_random(1))
print(get_random(1))
print(get_random(1))
