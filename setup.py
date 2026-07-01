from setuptools import setup, find_packages
setup(
    name="netbox-cable-calc",
    version="1.0.0",
    description="Cable length calculator plugin for NetBox",
    author="Graham Adler",
    author_email="gadler@vsolpro.com",
    license="Apache-2.0",
    packages=find_packages(),
    include_package_data=True,
    package_data={
        "netbox_cable_calc": [
            "templates/netbox_cable_calc/*.html",
            "static/netbox_cable_calc/*.js",
            "layouts/*.json",
        ],
    },
    install_requires=[],
    classifiers=[
        "Framework :: Django",
        "Programming Language :: Python :: 3",
    ],
)
