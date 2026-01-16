#!/bin/bash

while read line; do
echo -----------------------------------------
echo $line	
../build/cpsl < $line; done < <(find ../TestFiles/ -type f -name '*.cpsl')
