#include "globals/symbol_table.hpp"
#include "ast/Program.hpp"
#include "globals/globals.hpp"
#include <iostream>


extern int yyparse();


int main()
{
  yyparse();
  std::cerr << "Done parsing. Now emitting" << std::endl;
  pNode->emit();
};
