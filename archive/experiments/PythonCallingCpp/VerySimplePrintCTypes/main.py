from ctypes import cdll
libprint = cdll.LoadLibrary('./libprint.so')

class Foo(object):
    def __init__(self):
        self.obj = libprint.Foo_new()

    def print(self,string = None):
        if string is not None:
            libprint.Foo_print_string(self.obj,string)
        else:
            libprint.Foo_print(self.obj)

if __name__ == "__main__":
    f = Foo()
    f.print()
    f.print("World")