#pragma once

#include "Node.hpp"
#include "Block.hpp"
#include "statements/Stop.hpp"

#include <iostream>

namespace ast {
	class Program : public Node {
	public:
		Program(Block *b) : block(b){}
		void emit(){
		    std::cerr<<"Emitting Program"<<std::endl;
		    block->emit();
		    ast::Stop stop;
		    stop.emit();
		}
		Block *block;
	};



}