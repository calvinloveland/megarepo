#!/usr/bin/env node

const argv = require('yargs/yargs')(process.argv.slice(2)).argv
const wordCount = argv.wordCount
const letterCount = argv.letterCount
var dictionary = []

const fs = require('fs')
fs.readFile('dictionary.csv', 'utf8' , (err, data) => {
	  if (err) {
		      console.error(err)
		      return
		    }
	  dictionary = data.split(/\r?\n/)
})

var phrases = []
var possibilities = []

for (i=0; i < dictionary.length; i++){
    possibilities.push(dictionary[i] + " ")
}
while(possibilites.length > 0){
    var check = possibilities.shift()
    var wc = (check.match(/ /g)||[]).length
    var cc = (check.length - wc)
    if(cc == letterCount && wc == wordCount){
	phrases.push(check)
    }
    else if (cc+wc < letterCount + wordCount && wc < wordCount){
	for (i=0; i < dictionary.length; i++){
    	   var word = dictionary[i]
	    if( word.length + cc < letterCount || (wc == wordCount - 1 && word.length + cc == letterCount)){
		possibilities.push(check + word + " ")
	    }
	}
    }
    
}
console.log(phrases.length + "- Possibilities for " + wordCount + " words and " + letterCount + "letters")
