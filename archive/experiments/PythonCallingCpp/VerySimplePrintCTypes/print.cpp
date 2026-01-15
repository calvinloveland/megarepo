#include <iostream>
#include <string>

class Foo{
    public:
        void print(){
            std::cout << "Hello" << std::endl;
        }
        void print(std::string s){
            std::cout << s << std::endl;
        }
};

extern "C" {
    Foo* Foo_new(){ return new Foo(); }
    void Foo_print(Foo* foo){ foo->print(); }
    void Foo_print_string(Foo* foo, std::string s){ foo->print(s); }
}