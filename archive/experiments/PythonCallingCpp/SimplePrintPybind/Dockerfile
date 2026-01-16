FROM gcc
WORKDIR /
COPY . .
RUN apt update
RUN apt install -y python3
RUN apt install -y python3-pip
RUN pip3 install "pybind11[global]"
RUN c++ -O3 -Wall -shared -std=c++11 -fPIC $(python3 -m pybind11 --includes) print.cpp -o example$(python3-config --extension-suffix)