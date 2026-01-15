#include<iostream>
#include<queue>
#include<mutex>

using namespace std;

template <class T>
class TSQueue{
		public:
			TSQueue();
			void push(T);
			T pop();
			int size();
		private:
			mutex qMutex;
			queue<T> myQueue; 
};

template <class T>
TSQueue<T>::TSQueue(){
	myQueue;
}

template <class T>
void TSQueue<T>::push(T item){
	lock_guard<mutex> guard(qMutex);
	myQueue.push(item);
}

template <class T>
T TSQueue<T>::pop(){
	lock_guard<mutex> guard(qMutex);
		T rValue = myQueue.front();
		myQueue.pop();
		return rValue;	
}

template <class T>
int TSQueue<T>::size(){
	lock_guard<mutex> guard(qMutex);
	return myQueue.size();
}
