#pragma once

#include "Statement.hpp"

namespace ast {
    class Stop : public Statement {
    public:
        void emit() {
            std::cout << "li $v0, 10 # Stop Statement" << std::endl
                      << "syscall" << std::endl;
        }
    };
}