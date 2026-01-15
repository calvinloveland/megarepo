docker build -t homemaker-test .

docker run -it --rm homemaker-test /bin/bash -c "apt-get update && apt-get install -y wget && wget -O - https://raw.githubusercontent.com/calvinloveland/homemaker/main/get_and_run.sh | bash"