I didn't get the report finished before the deadline. The code is all there though. For tools I used strace and htop
I would have like to have looked into the /proc/ filesystem but I simply didn't have the time.


0:(Division)
htop shows one CPU at 100% used by the Assign3 process
strace shows nothing until the ^C signal is set

1:(square root)
Nothing special happened as far as I saw
At a certain point I had a the sqrt in a loop. The ^C signal had to be sent multiple times before it was received.

2:(Allocate and Clean Memory)
This one actually also pegged a CPU core at 100% which is interesting. I would have expected it to be bound by memory I/O speeds. Apparently a single core is still the limit.
^C required being sent multiple times

3:(Allocate but Don't Clean Memory)
The pi really didn't like this one. Stack trace showed a lot of brk commands and then a lot of mprotect. htop froze
Eventually strace showed that the process was killed by SIGKILL. 
No long term effects on the pi once the process was killed though



