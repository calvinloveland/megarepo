#pragma once

class Register {
    Register(std::string s, bool* available) : m_string(s), m_available(available){
        *m_available = false;
    }
    bool* m_available;
    std::string m_string;
    ~Register(){
        *m_available = true;
    }
};


