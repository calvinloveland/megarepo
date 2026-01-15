from transformers import BertForSequenceClassification, BertTokenizer
import torch

# Initialize BERT model
def initialize_bert_model():
    model = BertForSequenceClassification.from_pretrained('bert-base-uncased', num_labels=2)
    tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')
    return model, tokenizer

# Convert movie data to BERT input
def convert_to_bert_input(movie_data, tokenizer):
    input_text = movie_data['title'] + ' ' + movie_data['year'] + ' ' + movie_data['genre'] + ' ' + movie_data['rating'] + ' ' + movie_data['summary']
    input_ids = tokenizer.encode(input_text, add_special_tokens=True)
    return input_ids

# Predict if a movie is a chick flick
def predict_chick_flick(movie_data, model, tokenizer):
    input_ids = convert_to_bert_input(movie_data, tokenizer)
    outputs = model(torch.tensor([input_ids]))
    prediction = torch.argmax(outputs[0])
    if prediction == 0:
        print('This is not a chick flick')
    else:
        print('This is a chick flick')

# Train the model
def train_model():
    movie_data_list = load_movie_data()
    model, tokenizer = initialize_bert_model()
    for movie_data in movie_data_list:
        input_ids = convert_to_bert_input(movie_data, tokenizer)
        if movie_data['chick_flick'] == 'y':
            labels = torch.tensor([1])
        else:
            labels = torch.tensor([0])
        outputs = model(torch.tensor([input_ids]), labels=labels)
        loss = outputs[0]
        loss.backward()
    return model

# Dump movie data to a file
def dump_movie_data(movie_data):
    with open('movie_data.txt', 'a') as f:
        f.write(str(movie_data) + '\n')

# Convert string to movie data dictionary
def convert_to_movie_data(movie_data_string):
    movie_data ={}
    movie_data_string = movie_data_string.replace('\'', '\"')
    movie_data['title'] = movie_data_string[0]
    movie_data['year'] = movie_data_string[1]
    movie_data['genre'] = movie_data_string[2]
    movie_data['rating'] = movie_data_string[3]
    movie_data['summary'] = movie_data_string[4]
    movie_data['chick_flick'] = movie_data_string[5]
    return movie_data

# Load movie data from file
def load_movie_data():
    movie_data_list = []
    with open('movie_data.txt', 'r') as f:
        for line in f:
            movie_data = convert_to_movie_data(line)
            movie_data_list.append(movie_data)
    return movie_data_list


# Collect movie data from user
def collect_movie_data():
    movie_data = {}
    movie_data['title'] = input('Enter the title of the movie: ')
    movie_data['year'] = input('Enter the year of the movie: ')
    movie_data['genre'] = input('Enter the genre of the movie: ')
    movie_data['rating'] = input('Enter the rating of the movie: ')
    movie_data['summary'] = input('Enter the summary of the movie: ')
    movie_data['chick_flick'] = input('Is this a chick flick? (y/n): ')
    return movie_data

if __name__ == '__main__':
    # Initialize the model
    model, tokenizer = initialize_bert_model()

    # Train the model
    model = train_model()

    # Collect movie data from user
    movie_data = collect_movie_data()

    # Predict if the movie is a chick flick
    predict_chick_flick(movie_data, model, tokenizer)

    # Dump movie data to a file
    dump_movie_data(movie_data)






