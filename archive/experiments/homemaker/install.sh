# install python3
sudo apt-get install -y python3 python3-pip
# install virtualenv
sudo pip3 install virtualenv
# make virtual environment
virtualenv -p python3 venv
# activate virtual environment
source venv/bin/activate
# install requirements
pip3 install homemaker/
# run the program
homemaker