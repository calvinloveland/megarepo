class Software:
    tags = []

    @classmethod
    def pre_pre_apt_packages(cls):
        return []

    @classmethod
    def pre_apt(cls):
        return []

    @classmethod
    def apt_packages(cls):
        return []

    @classmethod
    def post_apt(cls):
        return []

    @classmethod
    def check_if_installed(cls):
        raise NotImplementedError
