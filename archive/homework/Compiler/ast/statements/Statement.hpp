#pragma once

#include "../Node.hpp"
#include <iostream>

namespace ast{
class Statement: public Node{
public:
    void emit(){
        std::cerr << "This should be a specific derived" << std::endl;
    }
};
}
