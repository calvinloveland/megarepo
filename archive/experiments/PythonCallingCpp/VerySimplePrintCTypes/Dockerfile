FROM gcc
WORKDIR /
COPY . .
RUN g++ -c -fPIC VerySimplePrint/print.cpp -o print.o
RUN g++ -shared -Wl,-soname,libprint.so -o libprint.so  print.o
RUN apt install python3