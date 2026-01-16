cmake_minimum_required(VERSION 2.8)
project(CalvinCompiler)

find_package(BISON)
find_package(FLEX)

bison_target(Parser parser.y ${CMAKE_CURRENT_BINARY_DIR}/parser.cpp)
flex_target(Scanner scanner.l ${CMAKE_CURRENT_BINARY_DIR}/scanner.cpp)
add_flex_bison_dependency(Scanner Parser)

set(EXTRA_COMPILE_FLAGS "-g3 -std=c++14")

set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${EXTRA_COMPILE_FLAGS}")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS}")

file(GLOB shared_src
     "shared/*.hpp"
     "shared/*.cpp"
)
file(GLOB ast_src
        "ast/*.hpp"
        "ast/*.cpp"
        )
file(GLOB expressions_src
     "ast/expressions/*.hpp"
     "ast/expressions/*.cpp"
)
set(compiler_srcs
  main.cpp
        globals/symbol_table.hpp
        globals/symbol_table.cpp

  ast/Program.hpp

  ${expressions_src}
  ${shared_src}
  ${ast_src}
  ${BISON_Parser_OUTPUTS}
  ${FLEX_Scanner_OUTPUTS}
      )

add_executable(cpsl ${compiler_srcs})
target_link_libraries(cpsl ${BISON_LIBRARIES})
target_include_directories(cpsl PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

