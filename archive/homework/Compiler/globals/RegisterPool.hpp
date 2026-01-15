#pragma once

#include "Register.hpp"

class RegisterPool {
public:
    std::vector<std::pair<string, bool*>> availableRegisters;

    RegisterPool(){
        availableRegisters.push_back(std::pair<string, bool*>("$t1",new bool(true)));
        availableRegisters.push_back(std::pair<string, bool*>("$t2",new bool(true)));
        availableRegisters.push_back(std::pair<string, bool*>("$t3",new bool(true)));
        availableRegisters.push_back(std::pair<string, bool*>("$t4",new bool(true)));
        availableRegisters.push_back(std::pair<string, bool*>("$t5",new bool(true)));
        availableRegisters.push_back(std::pair<string, bool*>("$t6",new bool(true)));
        availableRegisters.push_back(std::pair<string, bool*>("$t7",new bool(true)));
        availableRegisters.push_back(std::pair<string, bool*>("$t8",new bool(true)));
        availableRegisters.push_back(std::pair<string, bool*>("$t9",new bool(true)));
        //TODO add the other registers?
    }
    Register getRegister(){
        for(std::pair<string, bool*> registerPair : availableRegisters){
            if(*registerPair.second)
                return new Register(registerPair.first, registerPair.second)
        }
        std::cout << "OH NO WE RAN OUT OF REGISTERS OH NOOOOOO. EXPLODING NOW!!!" << std::endl;
        return nullptr
    }
};
