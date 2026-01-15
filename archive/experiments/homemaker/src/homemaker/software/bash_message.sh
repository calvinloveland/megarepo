neofetch
# Verify the installed software each in one line
# Verify python
python3 --version
# Verify docker
docker --version
# Verify neovim grab only the third line which is the version
nvim --version | head -n 3 | tail -n 1 | awk '{print "neovim " $0}'
# Verify git
git --version
# Verify vscode grab only the first line which is the version
code --version | head -n 1 | awk '{print "vscode " $0}'
# Print welcome message in pretty colors
echo -e "\e[1;32mWelcome home $USER!\e[0m"
