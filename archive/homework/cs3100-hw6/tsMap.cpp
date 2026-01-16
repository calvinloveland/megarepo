#include<iostream>
#include<unordered_map>
#include<mutex>

using namespace std;

template <class T>
class TSMap{
		public:
			TSMap();
			void insert(int,T);
			T get(int);
		private:
			mutex mMutex;
			unordered_map<int,T> myMap; 
};

template <class T>
TSMap<T>::TSMap(){
	myMap;
}

template <class T>
void TSMap<T>::insert(int i,T item){
	lock_guard<mutex> guard(mMutex);
	myMap.insert(make_pair(i,item));
}

template <class T>
T TSMap<T>::get(int i){
	lock_guard<mutex> guard(mMutex);
	return myMap[i];	
}
