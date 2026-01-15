# make code directory in home directory
mkdir -p ~/code
# change to code directory
cd ~/code
# install sudo if not already installed
apt install -y sudo
# install git
sudo apt install -y git
# download the code
git clone https://github.com/calvinloveland/homemaker.git

./homemaker/install.sh