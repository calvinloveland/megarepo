use std::{
    fs::File,
    io::{prelude::*, stdin, BufReader},
    path::Path,
};

fn read_int() -> u32 {
    let mut input_text = String::new();
    stdin()
        .read_line(&mut input_text)
        .expect("failed to read from stdin");

    let trimmed = input_text.trim();
    match trimmed.parse::<u32>() {
        Ok(i) => return i,
        Err(..) => println!("failed to parse int: {}", trimmed),
    };
    0
}

fn lines_of_file(filename: impl AsRef<Path>) -> Vec<String> {
    let file = File::open(filename).expect("failed to find file");
    let buf = BufReader::new(file);
    buf.lines()
        .map(|line| line.expect("failed to read line"))
        .collect()
}
fn count_characters(string: &String) -> usize {
    string.chars().count() - string.matches(' ').count()
}

fn count_words(string: &String) -> usize {
    string.matches(' ').count() + 1
}

fn main() {
    let words = lines_of_file("dictionary.csv");
    let mut phrases = Vec::new();
    println!("Input the number of words");
    let word_count = read_int();
    println!("Input the number of letters");
    let letter_count = read_int();
    let mut possibilities: Vec<String> = words
        .to_vec()
        .into_iter()
        .filter(|w| w.len() <= (letter_count as usize) + 1 - (word_count as usize))
        .collect();
    while possibilities.len() > 0 {
        let check = possibilities.pop().expect("possibilities is empty!!");
        //println!("{}", check);
        let cc = count_characters(&check);
        let wc = count_words(&check);
        if cc == (letter_count as usize) && wc == (word_count as usize) {
            phrases.push(check);
        } else if wc < (word_count as usize) && cc < (letter_count as usize) {
            for word in &words {
                if word.len() + cc < (letter_count as usize)
                    || (wc == (word_count as usize) - 1
                        && word.len() + cc == (letter_count as usize))
                {
                    possibilities.push(format!("{} {}", check, word));
                }
            }
        }
    }
    println!(
        "{} - Possibilities for {} words and {} letters",
        phrases.len(),
        word_count,
        letter_count
    );
}
