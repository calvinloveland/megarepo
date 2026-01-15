import example
import time

example.print("Hello")
example.print("World")

import time

start = time.time()
a = 0
for i in range(1000000):
    a = a + i
end = time.time()
print(end - start)



start = time.time()
b = 0
for i in range(1000000):
    b = example.add(b,i)
end = time.time()
print(end - start)